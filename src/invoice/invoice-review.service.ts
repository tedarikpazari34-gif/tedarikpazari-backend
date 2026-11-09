import {
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceNotifier } from './invoice-notifier.service';
import { assertInvoiceSnapshot } from './invoice-integrity';
import { assertReturnDocumentEligible } from './invoice-return-policy';

@Injectable()
export class AdminInvoiceReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: InvoiceNotifier,
  ) {}

  async review(
    user: any,
    invoiceId: string,
    body: { action?: string; reason?: string },
  ) {
    if (
      user?.role !== Role.ADMIN ||
      typeof user.id !== 'string' ||
      !user.id
    ) {
      throw new ForbiddenException('Admin yetkisi gerekli');
    }

    if (!invoiceId?.trim()) {
      throw new BadRequestException('Fatura kimliği gerekli');
    }

    const action = body?.action;

    if (action !== 'APPROVE' && action !== 'REJECT') {
      throw new BadRequestException('Geçersiz inceleme kararı');
    }

    const reason =
      typeof body?.reason === 'string'
        ? body.reason.trim()
        : '';

    if (reason.length > 1000) {
      throw new BadRequestException('Gerekçe en fazla 1000 karakter olabilir');
    }

    if (action === 'REJECT' && reason.length < 10) {
      throw new BadRequestException(
        'Ret gerekçesi en az 10 karakter olmalıdır',
      );
    }

    // Kilit için sipariş kimliği okunur.
    // Kayıt transaction içinde tekrar doğrulanır.
    const initial = await this.prisma.invoiceRecord.findUnique({
      where: { id: invoiceId },
      select: { orderId: true },
    });

    if (!initial) {
      throw new NotFoundException('Fatura bulunamadı');
    }

    const completed = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${'order-lifecycle:' + initial.orderId}, 0)
        )::text
      `;

      const record = await tx.invoiceRecord.findUnique({
        where: { id: invoiceId },
        select: {
          id: true,
          orderId: true,
          buyerId: true,
          sellerId: true,
          issuerCompanyId: true,
          originalSaleInvoiceId: true,
          disputeId: true,
          kind: true,
          currency: true,
          netAmount: true,
          vatAmount: true,
          totalAmount: true,
          status: true,
          fileMimeType: true,
          storagePublicId: true,
          storageResourceType: true,
          storageDeliveryType: true,
          order: {
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
          },
        },
      });

      if (!record || record.orderId !== initial.orderId) {
        throw new NotFoundException('Fatura bulunamadı');
      }

      if (record.status !== 'PENDING_REVIEW') {
        throw new ConflictException(
          'Fatura daha önce sonuçlandırılmış',
        );
      }

      const expectedIssuer =
        record.kind === 'RETURN'
          ? record.buyerId
          : record.kind === 'SALE' ||
              record.kind === 'CREDIT_NOTE'
            ? record.sellerId
            : null;

      if (
        !expectedIssuer ||
        record.issuerCompanyId !== expectedIssuer
      ) {
        throw new BadRequestException(
          'Belge türü ve düzenleyen şirket uyuşmuyor',
        );
      }

      if (
        record.fileMimeType !== 'application/pdf' ||
        record.storageResourceType !== 'raw' ||
        record.storageDeliveryType !== 'authenticated' ||
        typeof record.storagePublicId !== 'string' ||
          !/^tedarik-pazari-platform\/invoices\/[A-Za-z0-9_-]+$/.test(
            record.storagePublicId,
          )
      ) {
        throw new BadRequestException(
          'Özel fatura belgesi doğrulanamadı',
        );
      }

      if (action === 'APPROVE') {
        if (record.kind === 'SALE') {
          const order = record.order;

          if (
            !order ||
            order.id !== record.orderId ||
            order.buyerId !== record.buyerId ||
            order.sellerId !== record.sellerId ||
            record.issuerCompanyId !== record.sellerId ||
            !['PAID', 'PREPARING', 'SHIPPED', 'COMPLETED'].includes(
              order.status,
            ) ||
            !order.iyzicoPaidAt ||
            !order.iyzicoPaymentTransactionId
          ) {
            throw new BadRequestException(
              'Sipariş ve fatura ilişkisi doğrulanamadı',
            );
          }

          // Siparişin kayıtlı tutarlarıyla fatura alanlarını karşılaştır.
          // Bu kontrol PDF içindeki rakamları okumaz veya doğrulamaz.
          assertInvoiceSnapshot(record, order);

          const payment = await tx.paymentTransaction.findUnique({
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
            payment.sellerId !== record.sellerId ||
            payment.status !== 'SUCCESS' ||
            payment.iyzicoRefundPendingAt ||
            payment.iyzicoRefundedAt
          ) {
            throw new BadRequestException(
              'iyzico ödeme veya iade kaydı doğrulanamadı',
            );
          }
        } else {
          const order = record.order;

          if (
            !order ||
            !record.originalSaleInvoiceId ||
            !record.disputeId ||
            !['RETURN', 'CREDIT_NOTE'].includes(record.kind)
          ) {
            throw new BadRequestException(
              'İade belgesi ve orijinal fatura bağlantısı eksik',
            );
          }

          const dispute = await tx.dispute.findUnique({
            where: { id: record.disputeId },
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
            throw new BadRequestException(
              'İade belgesine bağlı uyuşmazlık bulunamadı',
            );
          }

          const original = await tx.invoiceRecord.findUnique({
            where: { id: record.originalSaleInvoiceId },
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

          if (!order.iyzicoPaymentTransactionId) {
            throw new BadRequestException(
              'Kanonik iyzico işlem kimliği bulunamadı',
            );
          }

          const payment = await tx.paymentTransaction.findUnique({
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

          if (!original || !payment) {
            throw new BadRequestException(
              'Orijinal fatura veya iyzico iadesi bulunamadı',
            );
          }

          assertReturnDocumentEligible({
            actor: {
              role: record.kind === 'RETURN'
                ? Role.BUYER
                : Role.SELLER,
              companyId: record.issuerCompanyId,
            },
            kind: record.kind,
            dispute,
            order,
            payment,
            saleInvoice: original,
          });

          let amountsMatch = true;

          try {
            amountsMatch =
              record.currency === original.currency &&
              (
                ['netAmount', 'vatAmount', 'totalAmount'] as const
              ).every(field => {
                const actual = new Prisma.Decimal(record[field]);
                const expected = new Prisma.Decimal(original[field]);

                return (
                  actual.isFinite() &&
                  expected.isFinite() &&
                  actual.gte(0) &&
                  expected.gte(0) &&
                  actual.equals(expected)
                );
              });
          } catch {
            amountsMatch = false;
          }

          if (!amountsMatch) {
            throw new BadRequestException(
              'İade belgesinin kayıtlı tutarları orijinal faturayla uyuşmuyor',
            );
          }
        }

        // Aynı sipariş ve belge türü için ikinci onayı engelle.
        const recorded = await tx.invoiceRecord.findFirst({
          where: {
            orderId: record.orderId,
            kind: record.kind,
            status: 'RECORDED',
            id: { not: record.id },
          },
          select: { id: true },
        });

        if (recorded) {
          throw new ConflictException(
            'Bu sipariş ve belge türü zaten onaylanmış',
          );
        }
      }

      const status =
        action === 'APPROVE' ? 'RECORDED' : 'REJECTED';

      // Koşullu güncelleme eşzamanlı ikinci kararı engeller.
      const result = await tx.invoiceRecord.updateMany({
        where: {
          id: invoiceId,
          orderId: initial.orderId,
          status: 'PENDING_REVIEW',
        },
        data: {
          status,
          reviewedByUserId: user.id,
          reviewedAt: new Date(),
          reviewNote: reason || null,
        },
      });

      if (result.count !== 1) {
        throw new ConflictException(
          'Fatura durumu eşzamanlı olarak değişti',
        );
      }

      const notices = [];

      if (action === 'APPROVE') {
        notices.push(...await this.notifier.stage(
          tx,
          'BUYER',
          record.buyerId,
          {
            title: 'Fatura kaydı onaylandı',
            message: `Sipariş ${record.orderId} için fatura kaydı platformda onaylandı.`,
            link: '/buyer/orders',
          },
        ));

        notices.push(...await this.notifier.stage(
          tx,
          'SELLER',
          record.sellerId,
          {
            title: 'Fatura incelemesi tamamlandı',
            message: `Sipariş ${record.orderId} için fatura kaydınız onaylandı.`,
            link: '/seller/orders',
          },
        ));
      } else {
        const buyerIssued = record.issuerCompanyId === record.buyerId;

        notices.push(...await this.notifier.stage(
          tx,
          buyerIssued ? 'BUYER' : 'SELLER',
          record.issuerCompanyId,
          {
            title: 'Belge kaydı reddedildi',
            message: `Sipariş ${record.orderId} için belgeniz reddedildi. Gerekçe: ${reason}`,
            link: buyerIssued
              ? '/buyer/orders'
              : '/seller/orders',
          },
        ));
      }

      return {
        invoiceId,
        orderId: initial.orderId,
        status,
        reviewNote: reason || null,
        notices,
      };
    });

    // Tamamlanan yönetici kararı bildirim hatasından etkilenmemeli.
    try {
      this.notifier.publish(completed.notices);
    } catch {
      Logger.warn(
        'Fatura inceleme kararı kaydedildi fakat anlık bildirim başarısız',
        AdminInvoiceReviewService.name,
      );
    }

    return {
      invoiceId: completed.invoiceId,
      orderId: completed.orderId,
      status: completed.status,
      reviewNote: completed.reviewNote,
    };
  }
}
