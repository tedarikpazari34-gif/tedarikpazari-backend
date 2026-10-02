import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { DisputeStatus, LedgerType, OrderStatus, Prisma, Role } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';
import { ShipOrderDto } from './dto/ship-order.dto';
import { CreateDirectOrderDto } from './dto/create-direct-order.dto';
import { IyzicoService } from '../payments/iyzico.service';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
  private prisma: PrismaService,
  private notificationService: NotificationService,
  private mailService: MailService,
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

  async createDirect(user: any, body: CreateDirectOrderDto) {
    if (!user || user.role !== Role.BUYER) {
      throw new ForbiddenException('Sadece BUYER sipariş oluşturabilir');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: body.productId },
      include: {
        seller: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    if (!product.isActive || !product.isApproved) {
      throw new BadRequestException('Bu ürün satışa açık değil');
    }

    if (product.sellerId === user.companyId) {
      throw new BadRequestException('Kendi ürününüzü satın alamazsınız');
    }

    if (body.quantity < product.moq) {
      throw new BadRequestException(
        `Minimum sipariş miktarı ${product.moq} ${product.unitType}`,
      );
    }

    const unitPrice = new Prisma.Decimal(product.basePrice);
    const quantity = new Prisma.Decimal(body.quantity);

    const totalAmount = unitPrice
      .mul(quantity)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const vatRate = product.vatRate ?? 0;

    if (vatRate < 0 || vatRate > 100) {
      throw new BadRequestException('Geçersiz KDV oranı');
    }

    const vatDivisor = new Prisma.Decimal(1).add(
      new Prisma.Decimal(vatRate).div(100),
    );

    const netAmount = totalAmount
      .div(vatDivisor)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const vatAmount = totalAmount
      .minus(netAmount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    if (totalAmount.lte(0)) {
      throw new BadRequestException('Sipariş tutarı 0 olamaz');
    }

    const commissionAmount = totalAmount
      .mul(new Prisma.Decimal(0.03))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const escrowAmount = totalAmount;
    const payoutAmount = totalAmount
      .minus(commissionAmount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const order = await this.prisma.order.create({
      data: {
        productId: product.id,
        quantity: body.quantity,
        buyerId: user.companyId,
        sellerId: product.sellerId,
        netAmount,
        vatRate,
        vatAmount,
        totalAmount,
        commissionAmount,
        escrowAmount,
        payoutAmount,
        status: OrderStatus.PENDING_PAYMENT,
      },
      include: {
        product: true,
        buyer: true,
        seller: true,
      },
    });

    const sellerUser = await this.prisma.user.findFirst({
      where: { companyId: product.sellerId },
    });

    if (sellerUser) {
      await this.notificationService.createNotification({
        userId: sellerUser.id,
        type: 'ORDER',
        title: 'Yeni Sipariş',
        message: `${product.title} için ${body.quantity} ${product.unitType} doğrudan sipariş oluşturuldu.`,
        link: '/seller/orders',
      });
    }

    return {
      message: 'Sipariş oluşturuldu',
      order,
    };
  }

  async createFromQuote(user: any, quoteId: string) {
    if (!user || user.role !== Role.BUYER) {
      throw new ForbiddenException('Sadece BUYER sipariş oluşturabilir');
    }

    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        rfq: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!quote) {
      throw new NotFoundException('Quote bulunamadı');
    }

    if (!quote.rfq) {
      throw new BadRequestException('Quote RFQ ilişkisi bulunamadı');
    }

    if (quote.rfq.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu teklif size ait değil');
    }

    if (quote.status !== 'SENT') {
      throw new BadRequestException('Bu teklif artık kullanılamaz');
    }

    if (quote.rfq.status !== 'OPEN') {
      throw new BadRequestException('RFQ açık değil');
    }

    const existingOrder = await this.prisma.order.findFirst({
      where: {
        OR: [{ rfqId: quote.rfqId }, { quoteId: quote.id }],
      },
    });

    if (existingOrder) {
      throw new BadRequestException(
        'Bu teklif için zaten sipariş oluşturulmuş',
      );
    }

    const totalAmount = new Prisma.Decimal(quote.unitPrice).mul(
      new Prisma.Decimal(quote.rfq.quantity),
    );

    const commissionAmount = totalAmount
      .mul(new Prisma.Decimal(0.03))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const escrowAmount = totalAmount;
    const payoutAmount = totalAmount
      .minus(commissionAmount)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          rfqId: quote.rfqId,
          quoteId: quote.id,
          buyerId: quote.rfq.buyerId,
          sellerId: quote.sellerId,
          totalAmount,
          commissionAmount,
          escrowAmount,
          payoutAmount,
          status: OrderStatus.PENDING_PAYMENT,
        },
      });

      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: 'ACCEPTED',
        },
      });

      await tx.quote.updateMany({
        where: {
          rfqId: quote.rfqId,
          id: { not: quote.id },
        },
        data: {
          status: 'REJECTED',
        },
      });

      await tx.rFQ.update({
        where: { id: quote.rfqId },
        data: {
          status: 'CLOSED',
        },
      });

      return {
        message: 'Order oluşturuldu',
        order,
      };
    });

    const sellerUser = await this.prisma.user.findFirst({
      where: { companyId: quote.sellerId },
    });

    if (sellerUser) {
      await this.notificationService.createNotification({
        userId: sellerUser.id,
        type: 'ORDER',
        title: 'Teklifiniz Kabul Edildi',
        message: `${quote.rfq.product?.title || quote.rfq.title || 'Alım Talebi'} için verdiğiniz teklif siparişe dönüştü.`,
        link: '/seller/orders',
      });
    }

    return result;
  }

  async list(user: any) {
    const includeRelations = {
      rfq: {
        include: {
          product: true,
        },
      },
      product: true,
      quote: true,
      buyer: true,
      seller: true,
    };

    if (user.role === Role.ADMIN) {
      return this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: includeRelations,
      });
    }

    if (user.role === Role.BUYER) {
      return this.prisma.order.findMany({
        where: {
          buyerId: user.companyId,
        },
        orderBy: { createdAt: 'desc' },
        include: includeRelations,
      });
    }

    if (user.role === Role.SELLER) {
      return this.prisma.order.findMany({
        where: {
          sellerId: user.companyId,
        },
        orderBy: { createdAt: 'desc' },
        include: includeRelations,
      });
    }

    throw new ForbiddenException('Yetkisiz');
  }

  async getOne(user: any, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        rfq: {
          include: {
            product: true,
          },
        },
        product: true,
        quote: true,
        buyer: true,
        seller: true,
        disputes: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const isAdmin = user.role === Role.ADMIN;

    const isOwner =
      order.buyerId === user.companyId || order.sellerId === user.companyId;

    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('Bu order size ait değil');
    }

    return order;
  }

  async cancel(user: any, orderId: string) {
    if (user.role !== Role.BUYER) {
      throw new ForbiddenException('Sadece BUYER sipariş iptal edebilir');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu order size ait değil');
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException(
        'Sadece ödeme bekleyen siparişler iptal edilebilir',
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CANCELLED },
    });
  }

  async prepare(user: any, orderId: string) {
  if (user.role !== Role.SELLER) {
    throw new ForbiddenException('Sadece SELLER hazırlayabilir');
  }

  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  if (order.sellerId !== user.companyId) {
    throw new ForbiddenException('Bu order size ait değil');
  }

  if (order.status !== OrderStatus.PAID) {
    throw new BadRequestException(
      `Order PAID değil. Mevcut status: ${order.status}`,
    );
  }

  const updated = await this.prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.PREPARING },
  });

  const buyerUser = await this.prisma.user.findFirst({
    where: { companyId: order.buyerId },
  });

  if (buyerUser) {
    await this.notificationService.createNotification({
      userId: buyerUser.id,
      type: 'ORDER',
      title: 'Sipariş Hazırlanıyor',
      message: 'Siparişiniz satıcı tarafından hazırlanmaya alındı.',
      link: '/buyer/orders',
    });
  }

  return {
    message: 'Order marked as PREPARING',
    order: updated,
  };
}

async ship(user: any, orderId: string, body: ShipOrderDto) {
  if (user.role !== Role.SELLER) {
    throw new ForbiddenException('Sadece SELLER gönderimi başlatabilir');
  }

  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  if (order.sellerId !== user.companyId) {
    throw new ForbiddenException('Bu order size ait değil');
  }

  if (order.status !== OrderStatus.PREPARING) {
    throw new BadRequestException(
      `Order PREPARING değil. Mevcut status: ${order.status}`,
    );
  }

  const claimed = await this.prisma.order.updateMany({
    where: {
      id: order.id,
      sellerId: user.companyId,
      status: OrderStatus.PREPARING,
    },
    data: {
      status: OrderStatus.SHIPPED,
      shippedAt: new Date(),
      shippingTrackingNo: body.shippingTrackingNo.trim(),
      shippingCompany: body.shippingCompany.trim(),
      shippingMethod: body.shippingMethod,
      shippingDispatchNo: body.shippingDispatchNo?.trim() || null,
    },
  });

  if (claimed.count !== 1) {
    throw new BadRequestException(
      'Sipariş gönderim durumu değişti. Sayfayı yenileyip tekrar kontrol edin.',
    );
  }

  const updated = await this.prisma.order.findUnique({
    where: { id: order.id },
  });

  if (!updated) {
    throw new NotFoundException('Order not found');
  }

  try {
    const buyerUser = await this.prisma.user.findFirst({
      where: { companyId: order.buyerId },
    });

    const isFreight = updated.shippingMethod === 'FREIGHT';
    const methodLabel = isFreight ? 'Ambar / Nakliye' : 'Kargo';
    const referenceLabel = isFreight
      ? 'Ambar Fiş / Gönderi No'
      : 'Takip No';
    const dispatchText = updated.shippingDispatchNo
      ? ` Sevk İrsaliyesi No: ${updated.shippingDispatchNo}.`
      : '';
    const shippingMessage =
      `${updated.shippingCompany || methodLabel} ile siparişiniz yola çıktı. ` +
      `${referenceLabel}: ${updated.shippingTrackingNo || '-'}.${dispatchText}`;

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const safeShippingCompany = escapeHtml(
      updated.shippingCompany || methodLabel,
    );
    const safeShippingTrackingNo = escapeHtml(
      updated.shippingTrackingNo || '-',
    );
    const safeShippingDispatchNo = updated.shippingDispatchNo
      ? escapeHtml(updated.shippingDispatchNo)
      : null;

    if (buyerUser) {
      await this.notificationService.createNotification({
        userId: buyerUser.id,
        type: 'ORDER',
        title: isFreight
          ? 'Sipariş Ambar / Nakliyeye Verildi'
          : 'Sipariş Kargoya Verildi',
        message: shippingMessage,
        link: '/buyer/orders',
      });
    }

    if (buyerUser?.email) {
      await this.mailService.sendMail({
        to: buyerUser.email,
        subject: isFreight
          ? 'Tedarik Pazarı - Siparişiniz ambar / nakliyeye verildi'
          : 'Tedarik Pazarı - Siparişiniz kargoya verildi',
        text: shippingMessage,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>${isFreight ? 'Siparişiniz ambar / nakliyeye verildi' : 'Siparişiniz kargoya verildi'}</h2>
            <p>${safeShippingCompany} ile siparişiniz yola çıktı.</p>
            <p><strong>${referenceLabel}:</strong> ${safeShippingTrackingNo}</p>
            ${
              safeShippingDispatchNo
                ? `<p><strong>Sevk İrsaliyesi No:</strong> ${safeShippingDispatchNo}</p>`
                : ''
            }
            <p>Siparişinizi alıcı panelinizden takip edebilirsiniz.</p>
          </div>
        `,
      });
    }
  } catch {
    this.logger.error(
      `Ship notification/mail failed for order ${order.id}`,
    );
  }

  return {
    message: 'Order marked as SHIPPED',
    order: updated,
  };
}

async complete(user: any, orderId: string) {
  if (user.role !== Role.BUYER) {
    throw new ForbiddenException('Sadece BUYER tamamlayabilir');
  }

  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  if (order.buyerId !== user.companyId) {
    throw new ForbiddenException('Bu order size ait değil');
  }

  if (order.status !== OrderStatus.SHIPPED) {
    throw new BadRequestException(
      `Order SHIPPED değil. Mevcut status: ${order.status}`,
    );
  }

  if (order.escrowReleased) {
    throw new BadRequestException('Escrow zaten serbest bırakılmış');
  }

  const { paymentTransaction, iyzicoAlreadyApproved } =
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${'order-lifecycle:' + order.id}, 0)
        )::text
      `;

      const currentOrder = await tx.order.findUnique({
        where: { id: order.id },
        select: {
          buyerId: true,
          status: true,
          escrowReleased: true,
          iyzicoPaymentId: true,
          iyzicoPaymentTransactionId: true,
        },
      });

      if (!currentOrder) {
        throw new NotFoundException('Order not found');
      }

      if (currentOrder.buyerId !== user.companyId) {
        throw new ForbiddenException('Bu order size ait değil');
      }

      if (
        currentOrder.status !== OrderStatus.SHIPPED ||
        currentOrder.escrowReleased
      ) {
        throw new BadRequestException(
          'Sipariş tamamlama için artık uygun durumda değil',
        );
      }

      const activeDispute = await tx.dispute.findFirst({
        where: {
          orderId: order.id,
          status: {
            in: [DisputeStatus.OPEN, DisputeStatus.SELLER_RESPONDED],
          },
        },
        select: { id: true },
      });

      if (activeDispute) {
        throw new BadRequestException(
          'Açık uyuşmazlık bulunan sipariş tamamlanamaz',
        );
      }

      if (!currentOrder.iyzicoPaymentTransactionId) {
        throw new BadRequestException(
          'Siparişin kanonik iyzico işlem kimliği bulunamadı; otomatik işlem yapılmayacak, mutabakat gerekli',
        );
      }

      const paymentTransaction = await tx.paymentTransaction.findUnique({
        where: {
          paymentTransactionId: currentOrder.iyzicoPaymentTransactionId,
        },
      });

      if (
        !paymentTransaction ||
        paymentTransaction.orderId !== order.id ||
        paymentTransaction.sellerId !== order.sellerId ||
        paymentTransaction.status !== 'SUCCESS'
      ) {
        throw new BadRequestException(
          'Siparişin kanonik iyzico işlem kaydı güvenle doğrulanamadı; mutabakat gerekli',
        );
      }

      if (!currentOrder.iyzicoPaymentId) {
        throw new BadRequestException(
          'Siparişin iyzico ödeme kimliği bulunamadı',
        );
      }

      const iyzicoAlreadyApproved = Boolean(
        paymentTransaction.iyzicoApprovedAt,
      );

      if (!iyzicoAlreadyApproved) {
        if (paymentTransaction.iyzicoApprovalPendingAt) {
          throw new BadRequestException(
            'iyzico satıcı ödeme onayı devam ediyor veya mutabakat bekliyor; otomatik tekrar yapılmayacak',
          );
        }

        if (
          paymentTransaction.iyzicoRefundPendingAt ||
          paymentTransaction.iyzicoRefundedAt ||
          new Prisma.Decimal(paymentTransaction.iyzicoRefundedAmount).gt(0)
        ) {
          throw new BadRequestException(
            'İade süreci bulunan ödeme için iyzico satıcı ödeme onayı başlatılamaz',
          );
        }

        const approvalClaim = await tx.paymentTransaction.updateMany({
          where: {
            id: paymentTransaction.id,
            status: 'SUCCESS',
            iyzicoApprovedAt: null,
            iyzicoApprovalPendingAt: null,
            iyzicoRefundPendingAt: null,
            iyzicoRefundedAt: null,
            iyzicoRefundedAmount: paymentTransaction.iyzicoRefundedAmount,
          },
          data: {
            iyzicoApprovalPendingAt: new Date(),
          },
        });

        if (approvalClaim.count !== 1) {
          throw new BadRequestException(
            'iyzico satıcı ödeme onayı başka bir istek tarafından başlatılmış veya ödeme kaydı değişmiş; otomatik tekrar yapılmayacak',
          );
        }
      }

      return {
        paymentTransaction,
        iyzicoAlreadyApproved,
      };
    });

  if (!iyzicoAlreadyApproved) {

    const approvalResult = await this.iyzico.approvePaymentItem(
      paymentTransaction.paymentTransactionId,
      order.iyzicoConversationId ?? undefined,
    );

    const safeApprovalResult =
      this.safeIyzicoApprovalResult(approvalResult);

    if (approvalResult?.status !== 'success') {
      await this.prisma.paymentTransaction.update({
        where: {
          id: paymentTransaction.id,
        },
        data: {
          iyzicoApprovalResult: safeApprovalResult ?? undefined,
        },
      });

      throw new BadRequestException(
        'iyzico satıcı ödeme onayı başarılı olarak doğrulanamadı; otomatik tekrar yapılmayacak, mutabakat gerekli',
      );
    }

    const approvalFinalize =
      await this.prisma.paymentTransaction.updateMany({
        where: {
          id: paymentTransaction.id,
          status: 'SUCCESS',
          iyzicoApprovedAt: null,
          iyzicoApprovalPendingAt: {
            not: null,
          },
          iyzicoRefundPendingAt: null,
          iyzicoRefundedAt: null,
          iyzicoRefundedAmount: paymentTransaction.iyzicoRefundedAmount,
        },
        data: {
          iyzicoApprovedAt: new Date(),
          iyzicoApprovalPendingAt: null,
          iyzicoApprovalResult: safeApprovalResult ?? undefined,
        },
      });

    if (approvalFinalize.count !== 1) {
      throw new BadRequestException(
        'iyzico satıcı ödeme onayı sağlayıcıda başarılı oldu ancak yerel kayıt güvenle kesinleştirilemedi; otomatik tekrar yapılmayacak, mutabakat gerekli',
      );
    }
  }

  const result = await this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${'order-lifecycle:' + order.id}, 0)
      )::text
    `;

    const currentOrder = await tx.order.findUnique({
      where: { id: order.id },
    });

    if (!currentOrder) {
      throw new NotFoundException('Order not found');
    }

    if (currentOrder.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu order size ait değil');
    }

    if (
      currentOrder.status !== OrderStatus.SHIPPED ||
      currentOrder.escrowReleased
    ) {
      throw new BadRequestException(
        'Sipariş local settlement için artık uygun durumda değil',
      );
    }

    const activeDispute = await tx.dispute.findFirst({
      where: {
        orderId: currentOrder.id,
        status: {
          in: [DisputeStatus.OPEN, DisputeStatus.SELLER_RESPONDED],
        },
      },
      select: { id: true },
    });

    if (activeDispute) {
      throw new BadRequestException(
        'Açık uyuşmazlık bulunan siparişte escrow serbest bırakılamaz',
      );
    }

    if (!currentOrder.iyzicoPaymentTransactionId) {
      throw new BadRequestException(
        'Siparişin kanonik iyzico işlem kimliği bulunamadı; escrow serbest bırakılmayacak, mutabakat gerekli',
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
        'Siparişin kanonik iyzico işlem kaydı escrow için güvenle doğrulanamadı; mutabakat gerekli',
      );
    }

    if (
      !currentPaymentTransaction.iyzicoApprovedAt ||
      currentPaymentTransaction.iyzicoApprovalPendingAt
    ) {
      throw new BadRequestException(
        'iyzico satıcı ödeme onayı kesinleşmeden escrow serbest bırakılamaz',
      );
    }

    if (
      currentPaymentTransaction.iyzicoRefundPendingAt ||
      currentPaymentTransaction.iyzicoRefundedAt ||
      new Prisma.Decimal(currentPaymentTransaction.iyzicoRefundedAmount).gt(0)
    ) {
      throw new BadRequestException(
        'İade süreci bulunan ödeme için escrow satıcıya serbest bırakılamaz',
      );
    }

    if (
      !new Prisma.Decimal(currentPaymentTransaction.amount).eq(
        new Prisma.Decimal(currentOrder.totalAmount),
      )
    ) {
      throw new BadRequestException(
        'Ödeme işlem tutarı sipariş toplamıyla uyuşmuyor; mutabakat gerekli',
      );
    }

    await this.ensureWallet(tx, currentOrder.buyerId);
    await this.ensureWallet(tx, currentOrder.sellerId);

    const escrowAmount = new Prisma.Decimal(currentOrder.escrowAmount);
    const payoutAmount = new Prisma.Decimal(currentOrder.payoutAmount);

    if (escrowAmount.lte(0)) {
      throw new BadRequestException(
        'Serbest bırakılabilir escrow tutarı bulunmuyor',
      );
    }

    const buyerWallet = await tx.companyWallet.findUnique({
      where: { companyId: currentOrder.buyerId },
    });

    if (!buyerWallet) {
      throw new NotFoundException('Buyer wallet not found');
    }

    if (new Prisma.Decimal(buyerWallet.locked).lt(escrowAmount)) {
      throw new BadRequestException('Buyer locked bakiye yetersiz');
    }

    const releaseClaim = await tx.order.updateMany({
      where: {
        id: currentOrder.id,
        status: OrderStatus.SHIPPED,
        escrowReleased: false,
      },
      data: {
        status: OrderStatus.COMPLETED,
        escrowReleased: true,
        releasedAt: new Date(),
      },
    });

    if (releaseClaim.count !== 1) {
      throw new BadRequestException(
        'Escrow başka bir işlem tarafından serbest bırakılmış veya sipariş durumu değişmiş',
      );
    }

    await tx.companyWallet.update({
      where: { companyId: currentOrder.buyerId },
      data: {
        locked: { decrement: escrowAmount },
      },
    });

    await tx.companyWallet.update({
      where: { companyId: currentOrder.sellerId },
      data: {
        available: { increment: payoutAmount },
      },
    });

    await tx.ledgerEntry.create({
      data: {
        orderId: currentOrder.id,
        type: LedgerType.ESCROW_RELEASE_SELLER,
        amount: payoutAmount,
        currency: 'TRY',
        note: 'Escrow released to seller after commission deduction',
      },
    });

    const updated = await tx.order.findUnique({
      where: { id: currentOrder.id },
    });

    if (!updated) {
      throw new NotFoundException('Order not found');
    }

    return {
      message: 'Order completed and escrow released',
      order: updated,
    };
  });

  try {
    const sellerUser = await this.prisma.user.findFirst({
      where: { companyId: order.sellerId },
    });

    if (sellerUser) {
      await this.notificationService.createNotification({
        userId: sellerUser.id,
        type: 'ORDER',
        title: 'Sipariş Tamamlandı',
        message:
          'Alıcı siparişi teslim aldığını onayladı. Tutar bakiyenize aktarıldı.',
        link: '/seller/orders',
      });
    }

    if (sellerUser?.email) {
      await this.mailService.sendMail({
        to: sellerUser.email,
        subject: 'Tedarik Pazarı - Sipariş tamamlandı',
        text: 'Alıcı siparişi teslim aldığını onayladı. Tutar bakiyenize aktarıldı.',
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>Sipariş tamamlandı</h2>
            <p>Alıcı siparişi teslim aldığını onayladı.</p>
            <p>Tutar bakiyenize aktarıldı.</p>
          </div>
        `,
      });
    }
  } catch (err) {
    console.error('complete notification/mail failed', err);
  }

  return result;
}
}