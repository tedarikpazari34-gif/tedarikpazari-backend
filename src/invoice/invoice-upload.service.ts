import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceRecordChannel,
  Prisma,
  Role,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStorageService } from './invoice-storage.service';
import { InvoiceNotifier } from './invoice-notifier.service';

@Injectable()
export class SellerInvoiceUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: InvoiceStorageService,
    private readonly notifier: InvoiceNotifier,
  ) {}

  private async verifyOrder(
    db: Prisma.TransactionClient,
    companyId: string,
    orderId: string,
  ) {
    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { status: true, verified: true },
    });

    if (
      !company ||
      company.status !== 'APPROVED' ||
      company.verified !== true
    ) {
      throw new ForbiddenException('Doğrulanmış satıcı gerekli');
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
        iyzicoPaidAt: true,
        iyzicoPaymentTransactionId: true,
      },
    });

    if (!order || order.sellerId !== companyId) {
      throw new NotFoundException('Sipariş bulunamadı');
    }

    if (
      !['PAID', 'PREPARING', 'SHIPPED', 'COMPLETED'].includes(
        order.status,
      ) ||
      !order.iyzicoPaidAt ||
      !order.iyzicoPaymentTransactionId
    ) {
      throw new BadRequestException(
        'Ödemesi doğrulanmamış sipariş için belge yüklenemez',
      );
    }

    const payment = await db.paymentTransaction.findUnique({
      where: {
        paymentTransactionId: order.iyzicoPaymentTransactionId,
      },
      select: {
        orderId: true,
        sellerId: true,
        status: true,
        iyzicoRefundPendingAt: true,
        iyzicoRefundedAt: true,
      },
    });

    if (
      !payment ||
      payment.orderId !== order.id ||
      payment.sellerId !== companyId ||
      payment.status !== 'SUCCESS' ||
      payment.iyzicoRefundPendingAt ||
      payment.iyzicoRefundedAt
    ) {
      throw new BadRequestException(
        'iyzico işlemi doğrulanamadı veya iade sürecinde',
      );
    }

    return order;
  }

  async uploadSale(
    user: any,
    orderId: string,
    file: Express.Multer.File,
    body: {
      invoiceNumber?: string;
      channel?: string;
      issuedAt?: string;
    },
  ) {
    if (
      user?.role !== Role.SELLER ||
      typeof user.companyId !== 'string' ||
      !user.companyId ||
      typeof user.id !== 'string' ||
      !user.id
    ) {
      throw new ForbiddenException('Satıcı yetkisi gerekli');
    }

    if (!orderId || typeof orderId !== 'string') {
      throw new BadRequestException('Sipariş kimliği gerekli');
    }

    if (
      !file ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.length === 0 ||
      file.buffer.length > 10 * 1024 * 1024 ||
      file.mimetype !== 'application/pdf' ||
      file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-'
    ) {
      throw new BadRequestException(
        'Geçerli PDF belgesi gerekli (en fazla 10 MB)',
      );
    }

    const invoiceNumber =
      typeof body?.invoiceNumber === 'string'
        ? body.invoiceNumber.trim()
        : '';

    if (!/^[A-Za-z0-9._/-]{1,64}$/.test(invoiceNumber)) {
      throw new BadRequestException('Geçersiz fatura numarası');
    }

    const channel = body?.channel;

    if (
      channel !== InvoiceRecordChannel.E_INVOICE &&
      channel !== InvoiceRecordChannel.E_ARCHIVE &&
      channel !== InvoiceRecordChannel.PAPER
    ) {
      throw new BadRequestException('Geçersiz fatura türü');
    }

    const dateText = body?.issuedAt;

    if (
      typeof dateText !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dateText)
    ) {
      throw new BadRequestException(
        'Fatura tarihi YYYY-MM-DD olmalıdır',
      );
    }

    const issuedAt = new Date(`${dateText}T00:00:00.000Z`);

    if (
      Number.isNaN(issuedAt.getTime()) ||
      issuedAt.toISOString().slice(0, 10) !== dateText ||
      issuedAt.getTime() > Date.now()
    ) {
      throw new BadRequestException('Geçersiz fatura tarihi');
    }

    // Dış dosya yüklemesinden önce sipariş ve ödeme kontrolü.
    await this.verifyOrder(this.prisma, user.companyId, orderId);

    const repeatedNumber = await this.prisma.invoiceRecord.findFirst({
      where: {
        issuerCompanyId: user.companyId,
        invoiceNumber,
      },
      select: {
        id: true,
        orderId: true,
        status: true,
      },
    });

    if (
      repeatedNumber &&
      (
        repeatedNumber.orderId !== orderId ||
        repeatedNumber.status !== 'REJECTED'
      )
    ) {
      throw new ConflictException(
        'Bu fatura numarası başka siparişte veya aktif kayıtta kullanılıyor',
      );
    }

    const sha256 = createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    const stored = await this.storage.upload(file.buffer, 'raw');

    const committed = await (async () => {
    try {
      if (
        !stored ||
        stored.resourceType !== 'raw' ||
        stored.deliveryType !== 'authenticated' ||
        typeof stored.publicId !== 'string' ||
        !/^tedarik-pazari-platform\/invoices\/[A-Za-z0-9_-]+$/.test(stored.publicId)
      ) {
        throw new InternalServerErrorException(
          'Ozel fatura depolama kaydi dogrulanamadi',
        );
      }
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${'order-lifecycle:' + orderId}, 0)
          )::text
        `;

        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${'invoice-order:' + orderId}, 0)
          )::text
        `;

        const order = await this.verifyOrder(
          tx, user.companyId, orderId,
        );

        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtextextended(
              ${'invoice-number:' + user.companyId + ':' + invoiceNumber},
              0
            )
          )::text
        `;

        const existing = await tx.invoiceRecord.findFirst({
          where: {
            orderId,
            kind: 'SALE',
            status: { in: ['PENDING_REVIEW', 'RECORDED'] },
          },
          select: { id: true },
        });

        if (existing) {
          throw new ConflictException(
            'Bu sipariş için aktif fatura kaydı zaten mevcut',
          );
        }

        const previous = await tx.invoiceRecord.findMany({
          where: {
            issuerCompanyId: user.companyId,
            invoiceNumber,
          },
          select: {
            orderId: true,
            kind: true,
            status: true,
            revision: true,
          },
          orderBy: { revision: 'desc' },
        });

        const reusable = previous.every(record =>
          record.orderId === orderId &&
          record.kind === 'SALE' &&
          record.status === 'REJECTED'
        );

        if (!reusable) {
          throw new ConflictException(
            'Fatura numarası başka siparişte veya aktif revizyonda kullanılıyor',
          );
        }

        const revision = (previous[0]?.revision ?? 0) + 1;

        if (
          !Number.isSafeInteger(revision) ||
          revision > 1000000000
        ) {
          throw new ConflictException(
            'Fatura revizyon sınırı aşıldı',
          );
        }

        const invoice = await tx.invoiceRecord.create({
          data: {
            orderId: order.id,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            issuerCompanyId: user.companyId,
            uploadedByUserId: user.id,
            kind: 'SALE',
            channel,
            status: 'PENDING_REVIEW',
            invoiceNumber,
            revision,
            issuedAt,
            currency: 'TRY',
            netAmount: order.netAmount,
            vatAmount: order.vatAmount,
            totalAmount: order.totalAmount,
            storagePublicId: stored.publicId,
            storageResourceType: stored.resourceType,
            storageDeliveryType: stored.deliveryType,
            fileSha256: sha256,
            fileMimeType: 'application/pdf',
          },
          select: {
            id: true,
            orderId: true,
            invoiceNumber: true,
            revision: true,
            status: true,
            createdAt: true,
          },
        });

        const notices = await this.notifier.stage(
          tx,
          'ADMIN',
          null,
          {
            title: 'Yeni fatura incelemesi',
            message: `Sipariş ${order.id} için yeni fatura belgesi yüklendi.`,
            link: '/admin/finance',
          },
        );

        return { invoice, notices };
      });
    } catch (error) {
      try {
        if (
          !stored ||
          stored.resourceType !== 'raw' ||
          stored.deliveryType !== 'authenticated' ||
          typeof stored.publicId !== 'string' ||
          !/^tedarik-pazari-platform\/invoices\/[A-Za-z0-9_-]+$/.test(stored.publicId)
        ) {
          throw new InternalServerErrorException(
            'Gecersiz fatura depolama referansi; manuel inceleme gerekli',
          );
        }

        await this.storage.remove(stored);
      } catch {
        throw new InternalServerErrorException(
          'Fatura kaydı ve dosya temizliği başarısız; manuel inceleme gerekli',
        );
      }
      throw error;
      }
    })();

    this.notifier.publish(committed.notices);
    return committed.invoice;
  }
}
