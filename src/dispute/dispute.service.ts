import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DisputeResolution,
  DisputeStatus,
  EscrowEventType,
  LedgerType,
  OrderStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { NotificationService } from '../notification/notification.service';
import { IyzicoService } from '../payments/iyzico.service';

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly iyzico: IyzicoService,
  ) {}

  private async ensureWallet(tx: Prisma.TransactionClient, companyId: string) {
    return tx.companyWallet.upsert({
      where: { companyId },
      create: {
        companyId,
        available: new Prisma.Decimal(0),
        locked: new Prisma.Decimal(0),
      },
      update: {},
    });
  }

  private safeIyzicoRefundResult(result: any) {
    if (!result || typeof result !== 'object') {
      return null;
    }

    return {
      status: result.status ?? null,
      paymentId: result.paymentId ?? null,
      conversationId: result.conversationId ?? null,
      price: result.price ?? null,
      currency: result.currency ?? null,
      hostReference: result.hostReference ?? null,
      refundHostReference: result.refundHostReference ?? null,
      retryable: result.retryable ?? null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      errorGroup: result.errorGroup ?? null,
    };
  }

  private safeIyzicoApprovalResult(result: any) {
    if (!result || typeof result !== 'object') {
      return null;
    }

    return {
      status: result.status ?? null,
      conversationId: result.conversationId ?? null,
      paymentTransactionId: result.paymentTransactionId ?? null,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      errorGroup: result.errorGroup ?? null,
    };
  }

  async open(user: any, orderId: string, reason: string, description?: string) {
    if (user.role !== Role.BUYER && user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece BUYER veya SELLER dispute açabilir');
    }

    if (!reason?.trim()) {
      throw new BadRequestException('reason zorunlu');
    }

    const { order, dispute } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${'order-lifecycle:' + orderId}, 0)
        )::text
      `;

      const order = await tx.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const isBuyer = order.buyerId === user.companyId;
      const isSeller = order.sellerId === user.companyId;

      if (!isBuyer && !isSeller) {
        throw new ForbiddenException('Bu order size ait değil');
      }

      if (order.escrowReleased === true) {
        throw new BadRequestException(
          'Escrow çözülmüş order için dispute açılamaz',
        );
      }

      if (
        order.status !== OrderStatus.PAID &&
        order.status !== OrderStatus.PREPARING &&
        order.status !== OrderStatus.SHIPPED
      ) {
        throw new BadRequestException(
          'Yalnızca ödemesi tamamlanmış aktif siparişler için dispute açılabilir',
        );
      }

      if (!order.iyzicoPaymentTransactionId) {
        throw new BadRequestException(
          'Siparişin kanonik iyzico işlem kimliği bulunamadı; uyuşmazlık otomatik açılamaz, mutabakat gerekli',
        );
      }

      const paymentTransaction = await tx.paymentTransaction.findUnique({
        where: {
          paymentTransactionId: order.iyzicoPaymentTransactionId,
        },
        select: {
          orderId: true,
          sellerId: true,
          status: true,
          iyzicoApprovedAt: true,
          iyzicoApprovalPendingAt: true,
        },
      });

      if (
        !paymentTransaction ||
        paymentTransaction.orderId !== order.id ||
        paymentTransaction.sellerId !== order.sellerId ||
        paymentTransaction.status !== 'SUCCESS'
      ) {
        throw new BadRequestException(
          'Siparişin kanonik iyzico işlem kaydı uyuşmazlık için güvenle doğrulanamadı; mutabakat gerekli',
        );
      }

      if (
        paymentTransaction?.iyzicoApprovalPendingAt ||
        paymentTransaction?.iyzicoApprovedAt
      ) {
        throw new BadRequestException(
          'Satıcı ödeme onayı başlamış veya tamamlanmış sipariş için yeni uyuşmazlık açılamaz; mutabakat gerekli',
        );
      }

      const existing = await tx.dispute.findFirst({
        where: {
          orderId,
          status: {
            in: [DisputeStatus.OPEN, DisputeStatus.SELLER_RESPONDED],
          },
        },
        select: { id: true },
      });

      if (existing) {
        throw new BadRequestException(
          'Bu order için zaten açık dispute var',
        );
      }

      const dispute = await tx.dispute.create({
        data: {
          orderId,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          reason: reason.trim(),
          description: description?.trim() || null,
          status: DisputeStatus.OPEN,
        },
      });

      return { order, dispute };
    });

    try {
      const openedByBuyer = user.role === Role.BUYER;
      const targetCompanyId = openedByBuyer ? order.sellerId : order.buyerId;

      const targetUser = await this.prisma.user.findFirst({
        where: {
          companyId: targetCompanyId,
        },
      });

      if (targetUser) {
        await this.notificationService.createNotification({
          userId: targetUser.id,
          type: 'ORDER',
          title: 'Uyuşmazlık Açıldı',
          message: openedByBuyer
            ? 'Bir siparişiniz için alıcı uyuşmazlık başlattı.'
            : 'Bir siparişiniz için satıcı uyuşmazlık başlattı.',
          link: openedByBuyer ? '/seller/orders' : '/buyer/orders',
        });
      }

      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: Role.ADMIN,
        },
        select: {
          id: true,
        },
      });

      for (const admin of adminUsers) {
        await this.notificationService.createNotification({
          userId: admin.id,
          type: 'SYSTEM',
          title: 'Yeni Uyuşmazlık',
          message: `Bir sipariş için yeni uyuşmazlık açıldı. Sebep: ${reason.trim()}`,
          link: '/admin/disputes',
        });
      }

    } catch {
      this.logger.error(
        `Dispute opened but notification failed for dispute ${dispute.id}`,
      );
    }

    return dispute;
  }

  async sellerRespond(user: any, disputeId: string, sellerNote: string) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER cevap verebilir');
    }

    if (!sellerNote?.trim()) {
      throw new BadRequestException('sellerNote zorunlu');
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    if (dispute.sellerId !== user.companyId) {
      throw new ForbiddenException('Bu dispute size ait değil');
    }

    if (dispute.status !== DisputeStatus.OPEN) {
      throw new BadRequestException('Dispute bu aşamada respond edilemez');
    }

    const base = dispute.description ?? '';
    const appended = `${base}${base ? '\n\n' : ''}[SELLER RESPONSE] ${sellerNote.trim()}`;

    return this.prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        description: appended,
        status: DisputeStatus.SELLER_RESPONDED,
      },
    });
  }

  async listMine(user: any) {
    if (user.role === Role.BUYER) {
      return this.prisma.dispute.findMany({
        where: { buyerId: user.companyId },
        orderBy: { createdAt: 'desc' },
        include: {
          order: true,
          files: true,
        },
      });
    }

    if (user.role === Role.SELLER) {
      return this.prisma.dispute.findMany({
        where: { sellerId: user.companyId },
        orderBy: { createdAt: 'desc' },
        include: {
          order: true,
          files: true,
        },
      });
    }

    throw new ForbiddenException('Yetkisiz');
  }

  async listAll(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN listeleyebilir');
    }

    return this.prisma.dispute.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        order: true,
        files: true,
      },
    });
  }

  async resolve(
    user: any,
    disputeId: string,
    body: ResolveDisputeDto,
    clientIp?: string,
  ) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN resolve edebilir');
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        order: true,
        files: true,
      },
    });

    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    if (!dispute.order) {
      throw new NotFoundException('Order not found');
    }

    if (
      dispute.status !== DisputeStatus.OPEN &&
      dispute.status !== DisputeStatus.SELLER_RESPONDED
    ) {
      throw new BadRequestException('Dispute bu aşamada resolve edilemez');
    }

    const order = dispute.order;

    if (order.escrowReleased === true) {
      throw new BadRequestException('Escrow zaten çözülmüş');
    }

    const escrowAmount = new Prisma.Decimal(order.escrowAmount);
    if (escrowAmount.lte(0)) {
      throw new BadRequestException('Escrow amount 0, resolve edilemez');
    }

    const resolution = body.resolution as DisputeResolution;
    const adminNote = body.adminNote?.trim() || null;
    const now = new Date();

    let iyzicoRefundAmount: Prisma.Decimal | null = null;

    if (resolution === DisputeResolution.REFUND_TO_BUYER) {
      iyzicoRefundAmount = escrowAmount;
    }

    if (resolution === DisputeResolution.PARTIAL_REFUND) {
      throw new BadRequestException(
        'Kısmi iade, iyzico Marketplace alt üye işyeri hakediş dağılımı tamamlanana kadar geçici olarak devre dışı',
      );
    }

    const escrowTypeMap: Record<DisputeResolution, EscrowEventType> = {
      RELEASE_TO_SELLER: EscrowEventType.RELEASE_TO_SELLER,
      REFUND_TO_BUYER: EscrowEventType.REFUND_TO_BUYER,
      PARTIAL_REFUND: EscrowEventType.PARTIAL_REFUND,
    };

    let paymentTransaction = null;

    let approvalContext: {
      paymentTransaction: any;
      iyzicoAlreadyApproved: boolean;
    } | null = null;

    if (resolution === DisputeResolution.RELEASE_TO_SELLER) {
      approvalContext = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${'order-lifecycle:' + order.id}, 0)
          )::text
        `;

        const currentDispute = await tx.dispute.findUnique({
          where: { id: dispute.id },
        });

        if (
          !currentDispute ||
          (currentDispute.status !== DisputeStatus.OPEN &&
            currentDispute.status !== DisputeStatus.SELLER_RESPONDED)
        ) {
          throw new BadRequestException(
            'Dispute satıcı ödeme onayı için artık uygun durumda değil',
          );
        }

        const currentOrder = await tx.order.findUnique({
          where: { id: order.id },
        });

        if (!currentOrder) {
          throw new NotFoundException('Order not found');
        }

        if (currentOrder.escrowReleased) {
          throw new BadRequestException('Escrow zaten çözülmüş');
        }

        if (!currentOrder.iyzicoPaymentId) {
          throw new BadRequestException(
            'Siparişin iyzico ödeme kimliği bulunamadı',
          );
        }

        if (!currentOrder.iyzicoPaymentTransactionId) {
          throw new BadRequestException(
            'Siparişin kanonik iyzico işlem kimliği bulunamadı; satıcı ödeme onayı başlatılmayacak, mutabakat gerekli',
          );
        }

        const currentPaymentTransaction =
          await tx.paymentTransaction.findUnique({
            where: {
              paymentTransactionId: currentOrder.iyzicoPaymentTransactionId,
            },
          });

        if (
          !currentPaymentTransaction ||
          currentPaymentTransaction.orderId !== currentOrder.id ||
          currentPaymentTransaction.sellerId !== currentOrder.sellerId ||
          currentPaymentTransaction.status !== 'SUCCESS'
        ) {
          throw new BadRequestException(
            'Siparişin kanonik iyzico işlem kaydı satıcı ödeme onayı için güvenle doğrulanamadı; mutabakat gerekli',
          );
        }

        if (
          !new Prisma.Decimal(currentPaymentTransaction.amount).equals(
            new Prisma.Decimal(currentOrder.totalAmount),
          )
        ) {
          throw new BadRequestException(
            'iyzico işlem tutarı sipariş toplamıyla uyuşmuyor; mutabakat gerekli',
          );
        }

        if (
          currentPaymentTransaction.iyzicoRefundPendingAt ||
          currentPaymentTransaction.iyzicoRefundedAt ||
          new Prisma.Decimal(
            currentPaymentTransaction.iyzicoRefundedAmount,
          ).gt(0)
        ) {
          throw new BadRequestException(
            'İade başlatılmış veya gerçekleşmiş iyzico işlemi satıcı lehine otomatik onaylanamaz; mutabakat gerekli',
          );
        }

        const iyzicoAlreadyApproved = Boolean(
          currentPaymentTransaction.iyzicoApprovedAt,
        );

        if (!iyzicoAlreadyApproved) {
          if (currentPaymentTransaction.iyzicoApprovalPendingAt) {
            throw new BadRequestException(
              'iyzico satıcı ödeme onayı devam ediyor veya mutabakat bekliyor; otomatik tekrar yapılmayacak',
            );
          }

          const approvalClaim = await tx.paymentTransaction.updateMany({
            where: {
              id: currentPaymentTransaction.id,
              status: 'SUCCESS',
              iyzicoApprovedAt: null,
              iyzicoApprovalPendingAt: null,
              iyzicoRefundPendingAt: null,
              iyzicoRefundedAt: null,
              iyzicoRefundedAmount: new Prisma.Decimal(0),
            },
            data: {
              iyzicoApprovalPendingAt: new Date(),
            },
          });

          if (approvalClaim.count !== 1) {
            throw new BadRequestException(
              'iyzico satıcı ödeme onayı başka bir işlem tarafından başlatılmış veya ödeme kaydı değişmiş; otomatik tekrar yapılmayacak',
            );
          }
        }

        return {
          paymentTransaction: currentPaymentTransaction,
          iyzicoAlreadyApproved,
        };
      });
    }

    if (
      resolution === DisputeResolution.RELEASE_TO_SELLER &&
      approvalContext
    ) {
      if (approvalContext.iyzicoAlreadyApproved) {
        throw new BadRequestException(
          'iyzico satıcı ödeme onayı daha önce tamamlanmış; otomatik settlement yapılmayacak, mutabakat gerekli',
        );
      }

      const approvalPaymentTransaction = approvalContext.paymentTransaction;

      const approvalResult = await this.iyzico.approvePaymentItem(
        approvalPaymentTransaction.paymentTransactionId,
        order.iyzicoConversationId ?? undefined,
      );

      const safeApprovalResult =
        this.safeIyzicoApprovalResult(approvalResult);

      if (approvalResult?.status !== 'success') {
        await this.prisma.paymentTransaction.update({
          where: { id: approvalPaymentTransaction.id },
          data: {
            iyzicoApprovalResult: safeApprovalResult ?? undefined,
          },
        });

        throw new BadRequestException(
          'iyzico satıcı ödeme onayını başarılı olarak doğrulamadı; otomatik tekrar yapılmayacak, mutabakat gerekli',
        );
      }

      const approvalRecorded =
        await this.prisma.paymentTransaction.updateMany({
          where: {
            id: approvalPaymentTransaction.id,
            status: 'SUCCESS',
            iyzicoApprovedAt: null,
            iyzicoApprovalPendingAt: {
              not: null,
            },
            iyzicoRefundPendingAt: null,
            iyzicoRefundedAt: null,
            iyzicoRefundedAmount: new Prisma.Decimal(0),
          },
          data: {
            iyzicoApprovedAt: new Date(),
            iyzicoApprovalPendingAt: null,
            iyzicoApprovalResult: safeApprovalResult ?? undefined,
          },
        });

      if (approvalRecorded.count !== 1) {
        throw new BadRequestException(
          'iyzico satıcı ödeme onayı provider tarafında başarılı oldu ancak yerel kayıt güvenle tamamlanamadı; mutabakat gerekli',
        );
      }
    }

    if (iyzicoRefundAmount) {
      if (!clientIp || clientIp.trim() === '') {
        throw new BadRequestException(
          'İade için istemci IP adresi alınamadı',
        );
      }

      paymentTransaction = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${'order-lifecycle:' + order.id}, 0)
          )::text
        `;

        const currentDispute = await tx.dispute.findUnique({
          where: { id: dispute.id },
        });

        if (
          !currentDispute ||
          (currentDispute.status !== DisputeStatus.OPEN &&
            currentDispute.status !== DisputeStatus.SELLER_RESPONDED)
        ) {
          throw new BadRequestException(
            'Dispute iade için artık uygun durumda değil',
          );
        }

        const currentOrder = await tx.order.findUnique({
          where: { id: order.id },
        });

        if (!currentOrder) {
          throw new NotFoundException('Order not found');
        }

        if (currentOrder.escrowReleased) {
          throw new BadRequestException('Escrow zaten çözülmüş');
        }

        if (!currentOrder.iyzicoPaymentId) {
          throw new BadRequestException(
            'Siparişin iyzico ödeme kimliği bulunamadı',
          );
        }

        if (!currentOrder.iyzicoPaymentTransactionId) {
          throw new BadRequestException(
            'Siparişin kanonik iyzico işlem kimliği bulunamadı; otomatik iade yapılmayacak, mutabakat gerekli',
          );
        }

        const currentPaymentTransaction =
          await tx.paymentTransaction.findUnique({
            where: {
              paymentTransactionId: currentOrder.iyzicoPaymentTransactionId,
            },
          });

        if (
          !currentPaymentTransaction ||
          currentPaymentTransaction.orderId !== currentOrder.id ||
          currentPaymentTransaction.sellerId !== currentOrder.sellerId ||
          currentPaymentTransaction.status !== 'SUCCESS'
        ) {
          throw new BadRequestException(
            'Siparişin kanonik iyzico işlem kaydı iade için güvenle doğrulanamadı; otomatik iade yapılmayacak, mutabakat gerekli',
          );
        }

        if (
          !new Prisma.Decimal(currentPaymentTransaction.amount).equals(
            new Prisma.Decimal(currentOrder.totalAmount),
          )
        ) {
          throw new BadRequestException(
            'iyzico işlem tutarı sipariş toplamıyla uyuşmuyor; mutabakat gerekli',
          );
        }

        if (
          !iyzicoRefundAmount.equals(
            new Prisma.Decimal(currentOrder.totalAmount),
          )
        ) {
          throw new BadRequestException(
            'İade tutarı güncel sipariş toplamıyla uyuşmuyor; otomatik iade yapılmayacak, mutabakat gerekli',
          );
        }

        if (
          currentPaymentTransaction.iyzicoApprovalPendingAt ||
          currentPaymentTransaction.iyzicoApprovedAt
        ) {
          throw new BadRequestException(
            'iyzico satıcı ödeme onayı başlamış veya tamamlanmış; otomatik iade yapılmayacak, mutabakat gerekli',
          );
        }

        if (currentPaymentTransaction.iyzicoRefundPendingAt) {
          throw new BadRequestException(
            'Bu iyzico işlemi için devam eden veya mutabakat bekleyen bir iade var',
          );
        }

        const alreadyRefunded = new Prisma.Decimal(
          currentPaymentTransaction.iyzicoRefundedAmount,
        );

        if (
          alreadyRefunded.gt(0) ||
          currentPaymentTransaction.iyzicoRefundedAt
        ) {
          throw new BadRequestException(
            'Bu iyzico işlemi için daha önce iade kaydedilmiş; otomatik tekrar yapılmayacak, mutabakat gerekli',
          );
        }

        const refundableAmount = new Prisma.Decimal(
          currentPaymentTransaction.amount,
        )
          .minus(alreadyRefunded)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

        if (iyzicoRefundAmount.gt(refundableAmount)) {
          throw new BadRequestException(
            'İstenen iade tutarı kalan iyzico iade edilebilir tutarını aşıyor',
          );
        }

        const refundClaim = await tx.paymentTransaction.updateMany({
          where: {
            id: currentPaymentTransaction.id,
            status: 'SUCCESS',
            iyzicoApprovedAt: null,
            iyzicoApprovalPendingAt: null,
            iyzicoRefundPendingAt: null,
            iyzicoRefundedAt: null,
            iyzicoRefundedAmount:
              currentPaymentTransaction.iyzicoRefundedAmount,
          },
          data: {
            iyzicoRefundPendingAt: new Date(),
          },
        });

        if (refundClaim.count !== 1) {
          throw new BadRequestException(
            'İade işlemi başka bir istek tarafından başlatılmış veya ödeme kaydı değişmiş; mutabakat gerekli',
          );
        }

        return currentPaymentTransaction;
      });
    }

    if (iyzicoRefundAmount && paymentTransaction) {
      const refundResult = await this.iyzico.refundPaymentItem(
        paymentTransaction.paymentTransactionId,
        iyzicoRefundAmount.toFixed(2),
        clientIp!.trim(),
        order.iyzicoConversationId ?? undefined,
        `Dispute refund: ${dispute.id}`,
      );

      const safeRefundResult = this.safeIyzicoRefundResult(refundResult);

      if (refundResult?.status !== 'success') {
        await this.prisma.paymentTransaction.update({
          where: { id: paymentTransaction.id },
          data: {
            iyzicoRefundResult: safeRefundResult ?? undefined,
          },
        });

        throw new BadRequestException(
          'iyzico iadeyi başarılı olarak doğrulamadı; otomatik tekrar yapılmayacak, mutabakat gerekli',
        );
      }

      const refundedAmount = new Prisma.Decimal(
        paymentTransaction.iyzicoRefundedAmount,
      )
        .add(iyzicoRefundAmount)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      const refundRecorded =
        await this.prisma.paymentTransaction.updateMany({
          where: {
            id: paymentTransaction.id,
            status: 'SUCCESS',
            iyzicoApprovedAt: null,
            iyzicoApprovalPendingAt: null,
            iyzicoRefundPendingAt: {
              not: null,
            },
            iyzicoRefundedAt: null,
            iyzicoRefundedAmount: paymentTransaction.iyzicoRefundedAmount,
          },
          data: {
            iyzicoRefundedAmount: refundedAmount,
            iyzicoRefundedAt: new Date(),
            iyzicoRefundResult: safeRefundResult ?? undefined,
            iyzicoRefundPendingAt: null,
          },
        });

      if (refundRecorded.count !== 1) {
        throw new BadRequestException(
          'iyzico iadesi sağlayıcıda başarılı oldu ancak yerel kayıt güvenle kesinleştirilemedi; otomatik tekrar yapılmayacak, mutabakat gerekli',
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${'order-lifecycle:' + order.id}, 0)
        )::text
      `;

      const currentDispute = await tx.dispute.findUnique({
        where: { id: dispute.id },
      });

      if (!currentDispute) {
        throw new NotFoundException('Dispute not found');
      }

      if (
        currentDispute.status !== DisputeStatus.OPEN &&
        currentDispute.status !== DisputeStatus.SELLER_RESPONDED
      ) {
        throw new BadRequestException(
          'Dispute başka bir işlem tarafından sonuçlandırılmış veya durumu değişmiş',
        );
      }

      const currentOrder = await tx.order.findUnique({
        where: { id: order.id },
      });

      if (!currentOrder) {
        throw new NotFoundException('Order not found');
      }

      if (currentOrder.escrowReleased === true) {
        throw new BadRequestException(
          'Escrow başka bir işlem tarafından çözülmüş',
        );
      }

      const currentEscrowAmount = new Prisma.Decimal(
        currentOrder.escrowAmount,
      );

      if (currentEscrowAmount.lte(0)) {
        throw new BadRequestException(
          'Güncel escrow amount 0, resolve edilemez',
        );
      }

      if (!currentOrder.iyzicoPaymentTransactionId) {
        throw new BadRequestException(
          'Siparişin kanonik iyzico işlem kimliği bulunamadı; settlement yapılmayacak, mutabakat gerekli',
        );
      }

      const settlementPaymentTransaction =
        await tx.paymentTransaction.findUnique({
          where: {
            paymentTransactionId: currentOrder.iyzicoPaymentTransactionId,
          },
        });

      if (
        !settlementPaymentTransaction ||
        settlementPaymentTransaction.orderId !== currentOrder.id ||
        settlementPaymentTransaction.sellerId !== currentOrder.sellerId ||
        settlementPaymentTransaction.status !== 'SUCCESS'
      ) {
        throw new BadRequestException(
          'Siparişin kanonik iyzico işlem kaydı settlement için güvenle doğrulanamadı; mutabakat gerekli',
        );
      }

      if (
        !new Prisma.Decimal(settlementPaymentTransaction.amount).equals(
          new Prisma.Decimal(currentOrder.totalAmount),
        )
      ) {
        throw new BadRequestException(
          'Settlement sırasında iyzico işlem tutarı sipariş toplamıyla uyuşmuyor; mutabakat gerekli',
        );
      }

      if (resolution === DisputeResolution.RELEASE_TO_SELLER) {
        if (
          !settlementPaymentTransaction.iyzicoApprovedAt ||
          settlementPaymentTransaction.iyzicoApprovalPendingAt
        ) {
          throw new BadRequestException(
            'iyzico satıcı ödeme onayı kesinleşmeden yerel settlement yapılamaz',
          );
        }

        if (
          settlementPaymentTransaction.iyzicoRefundPendingAt ||
          settlementPaymentTransaction.iyzicoRefundedAt ||
          new Prisma.Decimal(
            settlementPaymentTransaction.iyzicoRefundedAmount,
          ).gt(0)
        ) {
          throw new BadRequestException(
            'İade durumu bulunan iyzico işlemi satıcı lehine settlement yapılamaz; mutabakat gerekli',
          );
        }
      }

      if (resolution === DisputeResolution.REFUND_TO_BUYER) {
        if (
          settlementPaymentTransaction.iyzicoApprovalPendingAt ||
          settlementPaymentTransaction.iyzicoApprovedAt
        ) {
          throw new BadRequestException(
            'Satıcı ödeme onayı bulunan işlem alıcı iadesi olarak settlement yapılamaz; mutabakat gerekli',
          );
        }

        if (
          settlementPaymentTransaction.iyzicoRefundPendingAt ||
          !settlementPaymentTransaction.iyzicoRefundedAt ||
          !new Prisma.Decimal(
            settlementPaymentTransaction.iyzicoRefundedAmount,
          ).equals(new Prisma.Decimal(currentOrder.totalAmount))
        ) {
          throw new BadRequestException(
            'iyzico tam iadesi kesinleşmeden yerel refund settlement yapılamaz',
          );
        }
      }

      await this.ensureWallet(tx, currentOrder.buyerId);
      await this.ensureWallet(tx, currentOrder.sellerId);

      const buyerWallet = await tx.companyWallet.findUnique({
        where: { companyId: currentOrder.buyerId },
      });

      if (!buyerWallet) {
        throw new NotFoundException('Buyer wallet not found');
      }

      if (new Prisma.Decimal(buyerWallet.locked).lt(currentEscrowAmount)) {
        throw new BadRequestException(
          'Buyer locked bakiyesi güncel escrow için yetersiz',
        );
      }

      const disputeUpdated = await tx.dispute.update({
        where: { id: dispute.id },
        data: {
          resolution,
          adminNote,
          resolvedAt: now,
          status:
            resolution === DisputeResolution.RELEASE_TO_SELLER
              ? DisputeStatus.RESOLVED_SELLER
              : DisputeStatus.RESOLVED_BUYER,
        },
      });

      await tx.escrowEvent.upsert({
        where: { disputeId: dispute.id },
        create: {
          disputeId: dispute.id,
          orderId: currentOrder.id,
          type: escrowTypeMap[resolution],
          amount: currentEscrowAmount,
          note: adminNote ?? undefined,
        },
        update: {
          type: escrowTypeMap[resolution],
          amount: currentEscrowAmount,
          note: adminNote ?? undefined,
        },
      });

      if (resolution === DisputeResolution.RELEASE_TO_SELLER) {
        const sellerPayoutAmount = new Prisma.Decimal(currentOrder.payoutAmount);

        await tx.companyWallet.update({
          where: { companyId: currentOrder.buyerId },
          data: {
            locked: { decrement: currentEscrowAmount },
          },
        });

        await tx.companyWallet.update({
          where: { companyId: currentOrder.sellerId },
          data: {
            available: { increment: sellerPayoutAmount },
          },
        });

        await tx.ledgerEntry.create({
          data: {
            orderId: currentOrder.id,
            disputeId: dispute.id,
            type: LedgerType.ESCROW_RELEASE_SELLER,
            fromCompanyId: currentOrder.buyerId,
            toCompanyId: currentOrder.sellerId,
            amount: sellerPayoutAmount,
            currency: 'TRY',
            note: 'Dispute resolved: release to seller after commission deduction',
            meta: { disputeId: dispute.id },
          },
        });

        const orderUpdated = await tx.order.update({
          where: { id: currentOrder.id },
          data: {
            escrowAmount: new Prisma.Decimal(0),
            escrowReleased: true,
            releasedAt: now,
            status: OrderStatus.COMPLETED,
          },
        });

        return {
          message: 'dispute resolved: RELEASE_TO_SELLER',
          dispute: disputeUpdated,
          order: orderUpdated,
        };
      }

      if (resolution === DisputeResolution.REFUND_TO_BUYER) {
        await tx.companyWallet.update({
          where: { companyId: currentOrder.buyerId },
          data: {
            locked: { decrement: currentEscrowAmount },
          },
        });

        await tx.ledgerEntry.create({
          data: {
            orderId: currentOrder.id,
            disputeId: dispute.id,
            type: LedgerType.ESCROW_REFUND_BUYER,
            fromCompanyId: currentOrder.buyerId,
            toCompanyId: currentOrder.buyerId,
            amount: currentEscrowAmount,
            currency: 'TRY',
            note: 'Dispute resolved: refund to buyer',
            meta: { disputeId: dispute.id },
          },
        });

        await tx.ledgerEntry.create({
          data: {
            orderId: currentOrder.id,
            disputeId: dispute.id,
            type: LedgerType.COMMISSION_REVERSAL,
            amount: new Prisma.Decimal(currentOrder.commissionAmount),
            currency: 'TRY',
            note: 'Platform commission reversed after full iyzico refund',
            idempotencyKey: `commission-reversal:${dispute.id}`,
            meta: {
              disputeId: dispute.id,
              paymentTransactionId:
                settlementPaymentTransaction.paymentTransactionId,
            },
          },
        });

        const orderUpdated = await tx.order.update({
          where: { id: currentOrder.id },
          data: {
            escrowAmount: new Prisma.Decimal(0),
            escrowReleased: true,
            releasedAt: now,
            status: OrderStatus.CANCELLED,
          },
        });

        return {
          message: 'dispute resolved: REFUND_TO_BUYER',
          dispute: disputeUpdated,
          order: orderUpdated,
        };
      }

        throw new BadRequestException(
          'Kısmi iade bu settlement akışında devre dışı; iyzico Marketplace mutabakatı gerekli',
        );
      });

    try {
      const buyerUser = await this.prisma.user.findFirst({
        where: { companyId: order.buyerId },
      });

      const sellerUser = await this.prisma.user.findFirst({
        where: { companyId: order.sellerId },
      });

      const resultText =
        resolution === DisputeResolution.RELEASE_TO_SELLER
          ? 'Dispute satıcı lehine sonuçlandı.'
          : resolution === DisputeResolution.REFUND_TO_BUYER
            ? 'Dispute alıcı lehine sonuçlandı. Tutar iade edildi.'
            : 'Dispute kısmi iade ile sonuçlandı.';

      if (buyerUser) {
        await this.notificationService.createNotification({
          userId: buyerUser.id,
          type: 'ORDER',
          title: 'Dispute Sonuçlandı',
          message: resultText,
          link: '/buyer/orders',
        });
      }

      if (sellerUser) {
        await this.notificationService.createNotification({
          userId: sellerUser.id,
          type: 'ORDER',
          title: 'Dispute Sonuçlandı',
          message: resultText,
          link: '/seller/orders',
        });
      }
    } catch {
      this.logger.error(
        `Dispute resolution notification failed for dispute ${dispute.id}`,
      );
    }

    return result;
  }
  async addFile(user: any, disputeId: string, body: any) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
    });

    if (!dispute) {
      throw new NotFoundException('Dispute bulunamadı');
    }

    const isAdmin = user.role === 'ADMIN';
    const isBuyer = dispute.buyerId === user.companyId;
    const isSeller = dispute.sellerId === user.companyId;

    if (!isAdmin && !isBuyer && !isSeller) {
      throw new ForbiddenException('Bu dispute size ait değil');
    }

    return this.prisma.disputeFile.create({
      data: {
        disputeId,
        url: body.url,
        fileName: body.fileName,
        fileType: body.fileType,
        uploadedById: user.id,
      },
    });
  }
}
