import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceRecordChannel,
  InvoiceRecordKind,
  Prisma,
  Role,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStorageService } from './invoice-storage.service';
import { InvoiceNotifier } from './invoice-notifier.service';
import { assertReturnDocumentEligible } from './invoice-return-policy';

type Actor = {
  id: string;
  role: Role;
  companyId: string;
};

type UploadBody = {
  disputeId: string;
  kind?: string;
  originalSaleInvoiceId?: string;
  invoiceNumber?: string;
  channel?: string;
  issuedAt?: string;
};

@Injectable()
export class ReturnInvoiceUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: InvoiceStorageService,
    private readonly notifier: InvoiceNotifier,
  ) {}

  private async verify(
    db: Prisma.TransactionClient,
    actor: Actor,
    kind: InvoiceRecordKind,
    orderId: string,
    disputeId: string,
    originalSaleInvoiceId: string,
  ) {
    const company = await db.company.findUnique({
      where: { id: actor.companyId },
      select: { status: true, verified: true },
    });

    if (
      !company ||
      company.status !== 'APPROVED' ||
      company.verified !== true
    ) {
      throw new ForbiddenException(
        'Onaylı ve doğrulanmış şirket gerekli',
      );
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        totalAmount: true,
        iyzicoPaymentTransactionId: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Sipariş bulunamadı');
    }

    const dispute = await db.dispute.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        orderId: true,
        buyerId: true,
        sellerId: true,
        status: true,
        resolution: true,
        resolvedAt: true,
      },
    });

    if (!dispute) {
      throw new BadRequestException('Uyuşmazlık bulunamadı');
    }

    if (!order.iyzicoPaymentTransactionId) {
      throw new BadRequestException(
        'Kanonik iyzico işlem kimliği bulunamadı',
      );
    }

    const payment = await db.paymentTransaction.findUnique({
      where: {
        paymentTransactionId: order.iyzicoPaymentTransactionId,
      },
      select: {
        orderId: true,
        sellerId: true,
        amount: true,
        status: true,
        iyzicoRefundPendingAt: true,
        iyzicoRefundedAt: true,
        iyzicoRefundedAmount: true,
      },
    });

    const sale = await db.invoiceRecord.findUnique({
      where: { id: originalSaleInvoiceId },
      select: {
        id: true,
        orderId: true,
        buyerId: true,
        sellerId: true,
        issuerCompanyId: true,
        kind: true,
        status: true,
        currency: true,
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
      },
    });

    if (!payment || !sale) {
      throw new BadRequestException(
        'Ödeme veya orijinal satış faturası doğrulanamadı',
      );
    }

    assertReturnDocumentEligible({
      actor,
      kind,
      dispute,
      order,
      payment,
      saleInvoice: sale,
    });

    return { order, sale, dispute };
  }

  async upload(
    user: any,
    orderId: string,
    file: Express.Multer.File,
    body: UploadBody,
  ) {
    if (
      !user ||
      ![Role.BUYER, Role.SELLER].includes(user.role) ||
      typeof user.id !== 'string' ||
      !user.id ||
      typeof user.companyId !== 'string' ||
      !user.companyId
    ) {
      throw new ForbiddenException('Belge yükleme yetkisi yok');
    }

    const kind = body?.kind;

    if (
      kind !== InvoiceRecordKind.RETURN &&
      kind !== InvoiceRecordKind.CREDIT_NOTE
    ) {
      throw new BadRequestException('Geçersiz iade belgesi türü');
    }

    if (
      (kind === InvoiceRecordKind.RETURN &&
        user.role !== Role.BUYER) ||
      (kind === InvoiceRecordKind.CREDIT_NOTE &&
        user.role !== Role.SELLER)
    ) {
      throw new ForbiddenException('Belge türü rolünüzle uyuşmuyor');
    }

    const actor: Actor = {
      id: user.id,
      role: user.role,
      companyId: user.companyId,
    };

    if (
      typeof orderId !== 'string' ||
      !orderId ||
      typeof body?.disputeId !== 'string' ||
      !body.disputeId.trim() ||
      typeof body?.originalSaleInvoiceId !== 'string' ||
      !body.originalSaleInvoiceId
    ) {
      throw new BadRequestException(
        'Sipariş ve orijinal fatura kimliği gerekli',
      );
    }

    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.length < 5 ||
      file.buffer.length > 10 * 1024 * 1024 ||
      file.mimetype !== 'application/pdf' ||
      file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-'
    ) {
      throw new BadRequestException(
        'Geçerli PDF dosyası gerekli (en fazla 10 MB)',
      );
    }

    const number =
      typeof body.invoiceNumber === 'string'
        ? body.invoiceNumber.trim()
        : '';

    if (!/^[A-Za-z0-9._/-]{1,64}$/.test(number)) {
      throw new BadRequestException('Geçersiz fatura numarası');
    }

    const channel = body.channel;

    if (
      channel !== InvoiceRecordChannel.E_INVOICE &&
      channel !== InvoiceRecordChannel.E_ARCHIVE &&
      channel !== InvoiceRecordChannel.PAPER
    ) {
      throw new BadRequestException('Geçersiz belge türü');
    }

    const dateText = body.issuedAt;

    if (
      typeof dateText !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateText)
    ) {
      throw new BadRequestException('Geçersiz belge tarihi');
    }

    const issuedAt = new Date(`${dateText}T00:00:00.000Z`);

    if (
      Number.isNaN(issuedAt.getTime()) ||
      issuedAt.toISOString().slice(0, 10) !== dateText ||
      issuedAt.getTime() > Date.now()
    ) {
      throw new BadRequestException('Geçersiz belge tarihi');
    }

    // Dosyayı göndermeden önce ödeme ve şirket kontrolü.
    await this.verify(
      this.prisma,
      actor,
      kind,
      orderId,
      body.disputeId,
      body.originalSaleInvoiceId,
    );

    const sha256 = createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    const stored = await this.storage.upload(file.buffer, 'raw');

    try {
      if (
        stored.resourceType !== 'raw' ||
        stored.deliveryType !== 'authenticated' ||
        typeof stored.publicId !== 'string' ||
          !/^tedarik-pazari-platform\/invoices\/[A-Za-z0-9_-]+$/.test(
            stored.publicId,
          )
      ) {
        throw new InternalServerErrorException(
          'Özel fatura depolama kaydı doğrulanamadı',
        );
      }

      const committed = await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${'order-lifecycle:' + orderId}, 0)
          )::text
        `;

        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${'invoice-number:' + actor.companyId + ':' + number},
              0
            )
          )::text
        `;

        const { order, sale, dispute } = await this.verify(
          tx,
          actor,
          kind,
          orderId,
          body.disputeId,
          body.originalSaleInvoiceId!,
        );

        const active = await tx.invoiceRecord.findFirst({
          where: {
            orderId,
            kind,
            status: {
              in: ['PENDING_REVIEW', 'RECORDED'],
            },
          },
          select: { id: true },
        });

        if (active) {
          throw new ConflictException(
            'Bu sipariş için aktif iade belgesi mevcut',
          );
        }

        const previous = await tx.invoiceRecord.findMany({
          where: {
            issuerCompanyId: actor.companyId,
            invoiceNumber: number,
          },
          select: {
            orderId: true,
            originalSaleInvoiceId: true,
            kind: true,
            status: true,
            revision: true,
          },
          orderBy: { revision: 'desc' },
        });

        const reusable = previous.every(item =>
          item.orderId === orderId &&
          item.originalSaleInvoiceId === sale.id &&
          item.kind === kind &&
          item.status === 'REJECTED'
        );

        if (!reusable) {
          throw new ConflictException(
            'Bu belge numarası başka kayıtta kullanılıyor',
          );
        }

        const revision = (previous[0]?.revision ?? 0) + 1;

        if (
          !Number.isSafeInteger(revision) ||
          revision > 1000000000
        ) {
          throw new ConflictException(
            'Belge revizyon sınırı aşıldı',
          );
        }

        const invoice = await tx.invoiceRecord.create({
          data: {
            orderId,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            issuerCompanyId: actor.companyId,
            uploadedByUserId: actor.id,
            originalSaleInvoiceId: sale.id,
            disputeId: dispute.id,
            kind,
            channel,
            status: 'PENDING_REVIEW',
            invoiceNumber: number,
            revision,
            issuedAt,
            currency: sale.currency,
            netAmount: sale.netAmount,
            vatAmount: sale.vatAmount,
            totalAmount: sale.totalAmount,
            storagePublicId: stored.publicId,
            storageResourceType: stored.resourceType,
            storageDeliveryType: stored.deliveryType,
            fileSha256: sha256,
            fileMimeType: 'application/pdf',
          },
          select: {
            id: true,
            orderId: true,
            kind: true,
            revision: true,
            status: true,
          },
        });

        const notices = await this.notifier.stage(
          tx,
          'ADMIN',
          null,
          {
            title: 'İade belgesi incelemesi',
            message: `Sipariş ${orderId} için iade belgesi yüklendi.`,
            link: '/admin/finance',
          },
        );

        return { invoice, notices };
      });

      // Kaydedilmiş fatura, anlık bildirim hatasından etkilenmemeli.
      try {
        this.notifier.publish(committed.notices);
      } catch {
        Logger.warn(
          'İade belgesi kaydedildi fakat anlık bildirim başarısız',
          ReturnInvoiceUploadService.name,
        );
      }
      return committed.invoice;

    } catch (error) {
      try {
        await this.storage.remove(stored);
      } catch {
        throw new InternalServerErrorException(
          'Belge kaydı başarısız; dosya temizliği doğrulanamadı',
        );
      }

      throw error;
    }
  }
}
