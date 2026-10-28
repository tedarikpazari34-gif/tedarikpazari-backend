import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChargebackStatus, Prisma, PaymentProvider, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateChargebackInput {
  orderId: string;
  providerReference: string;
  disputedAmount: string;
  reason: string;
  notifiedAt: string;
  responseDueAt?: string;
  description?: string;
}

@Injectable()
export class ChargebackService {
  constructor(private readonly prisma: PrismaService) {}

  async updateResponseDeadline(
    actor: { id: string; role: string },
    caseId: string,
    responseDueAt: string,
    note: string,
  ) {
    if (!actor?.id || actor.role !== 'ADMIN') {
      throw new ForbiddenException('Sadece ADMIN islem yapabilir');
    }

    const explanation = typeof note === 'string' ? note.trim() : '';
    const due = typeof responseDueAt === 'string'
      ? new Date(responseDueAt)
      : new Date(NaN);

    if (
      !caseId?.trim() ||
      !explanation ||
      explanation.length < 10 ||
      explanation.length > 500 ||
      Number.isNaN(due.getTime()) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(responseDueAt)
    ) {
      throw new BadRequestException(
        'Resmi son tarih ve kaynak aciklamasi zorunludur',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.chargebackCase.findUnique({
        where: { id: caseId },
        select: {
          id: true,
          status: true,
          notifiedAt: true,
          responseDueAt: true,
        },
      });

      if (!existing) {
        throw new NotFoundException('Harcama itirazi bulunamadi');
      }

      if (!['OPEN', 'EVIDENCE_PREPARING'].includes(existing.status)) {
        throw new BadRequestException(
          'Bu asamada son yanit tarihi degistirilemez',
        );
      }

      if (due.getTime() < existing.notifiedAt.getTime()) {
        throw new BadRequestException(
          'Son yanit tarihi bildirim tarihinden once olamaz',
        );
      }

      if (existing.responseDueAt?.getTime() === due.getTime()) {
        return {
          id: caseId,
          responseDueAt: existing.responseDueAt,
          unchanged: true,
        };
      }

      const changed = await tx.chargebackCase.updateMany({
        where: {
          id: caseId,
          status: existing.status,
          responseDueAt: existing.responseDueAt,
        },
        data: { responseDueAt: due },
      });

      if (changed.count !== 1) {
        throw new ConflictException(
          'Itiraz bilgileri degismis; yeniden kontrol edin',
        );
      }

      await tx.chargebackEvent.create({
        data: {
          chargebackId: caseId,
          actorId: actor.id,
          action: 'RESPONSE_DEADLINE_SET_MANUALLY',
          note:
            'Eski son tarih: ' +
            (existing.responseDueAt?.toISOString() || 'BILINMIYOR') +
            ' | Yeni son tarih: ' + due.toISOString() +
            ' | Kaynak: ' + explanation,
        },
      });

      return {
        id: caseId,
        responseDueAt: due,
        unchanged: false,
      };
    });
  }

  async list() {
    return this.prisma.chargebackCase.findMany({
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        providerReference: true,
        disputedAmount: true,
        currency: true,
        reason: true,
        status: true,
        notifiedAt: true,
        responseDueAt: true,
        createdAt: true,
      },
    });
  }


  async changeStatus(
    actor: { id: string; role: string },
    caseId: string,
    expectedStatus: ChargebackStatus,
    nextStatus: ChargebackStatus,
    note: string,
    bankDecisionReference?: string,
    iyzicoSubmissionReference?: string,
    iyzicoSubmissionAt?: string,
  ) {
    if (!actor?.id || actor.role !== 'ADMIN') {
      throw new ForbiddenException('Sadece ADMIN islem yapabilir');
    }

    const transitions: Record<ChargebackStatus, ChargebackStatus[]> = {
      OPEN: ['EVIDENCE_PREPARING', 'CLOSED'],
      EVIDENCE_PREPARING: ['EVIDENCE_SUBMITTED', 'CLOSED'],
      EVIDENCE_SUBMITTED: ['UNDER_REVIEW'],
      UNDER_REVIEW: ['WON', 'LOST'],
      WON: ['CLOSED'],
      LOST: ['CLOSED'],
      CLOSED: [],
    };

    if (!caseId?.trim() ||
        !Object.prototype.hasOwnProperty.call(transitions, expectedStatus) ||
        !transitions[expectedStatus].includes(nextStatus) ||
        !note?.trim() || note.trim().length < 10 ||
        note.length > 1000) {
      throw new BadRequestException('Gecersiz chargeback durum gecisi');
    }

    if (nextStatus === 'WON' || nextStatus === 'LOST') {
      if (
        !bankDecisionReference?.trim() ||
        bankDecisionReference.trim().length < 5 ||
        bankDecisionReference.length > 150
      ) {
        throw new BadRequestException(
          'Banka karar referansi zorunludur',
        );
      }
    }

    if (nextStatus === 'EVIDENCE_SUBMITTED') {
      const reference = iyzicoSubmissionReference?.trim();
      const sentAt = iyzicoSubmissionAt
        ? new Date(iyzicoSubmissionAt)
        : null;

      if (
        !reference ||
        reference.length < 5 ||
        reference.length > 150 ||
        !sentAt ||
        Number.isNaN(sentAt.getTime()) ||
        sentAt.getTime() > Date.now()
      ) {
        throw new BadRequestException(
          'Iyzico gonderim referansi ve tarihi zorunludur',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.chargebackCase.findUnique({
        where: { id: caseId },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new NotFoundException('Chargeback kaydi bulunamadi');
      }

      if (existing.status !== expectedStatus) {
        throw new ConflictException('Chargeback durumu degismis; yeniden kontrol edin');
      }

      if (nextStatus === 'EVIDENCE_SUBMITTED') {
        const evidenceCount = await tx.chargebackEvidence.count({
          where: { chargebackId: caseId },
        });

        if (evidenceCount < 1) {
          throw new BadRequestException(
            'Delil bulunmadan banka itirazi gonderildi olarak isaretlenemez',
          );
        }
      }

      const changed = await tx.chargebackCase.updateMany({
        where: { id: caseId, status: expectedStatus },
        data: {
          status: nextStatus,
          ...(nextStatus === 'EVIDENCE_SUBMITTED'
            ? { evidenceSubmittedAt: new Date(iyzicoSubmissionAt!) }
            : {}),
          ...(nextStatus === 'WON' || nextStatus === 'LOST'
            ? { resolvedAt: new Date(), resolutionNote: note.trim() }
            : {}),
        },
      });

      if (changed.count !== 1) {
        throw new ConflictException('Eszamanli chargeback degisikligi tespit edildi');
      }

      await tx.chargebackEvent.create({
        data: {
          chargebackId: caseId,
          actorId: actor.id,
          action: nextStatus === 'EVIDENCE_SUBMITTED'
            ? 'IYZICO_SUBMISSION_RECORDED_MANUALLY'
            : 'STATUS_CHANGED',
          previousStatus: expectedStatus,
          nextStatus,
          note:
            nextStatus === 'WON' || nextStatus === 'LOST'
              ? note.trim() + ' | Banka karar referansi: ' +
                bankDecisionReference!.trim()
              : nextStatus === 'EVIDENCE_SUBMITTED'
                ? note.trim() +
                  ' | Manuel iyzico referansi: ' +
                  iyzicoSubmissionReference!.trim() +
                  ' | Gonderim tarihi: ' +
                  iyzicoSubmissionAt!
                : note.trim(),
        },
      });

      return { id: caseId, previousStatus: expectedStatus, status: nextStatus };
    });
  }

  async create(actor: { id: string; role: string }, input: CreateChargebackInput) {
    if (!actor || actor.role !== 'ADMIN' || !actor.id) {
      throw new ForbiddenException('Sadece ADMIN islem yapabilir');
    }

    const orderId = input?.orderId?.trim();
    const reference = input?.providerReference?.trim();
    const reason = input?.reason?.trim();

    if (!orderId || !reference || reference.length > 150 ||
        !reason || reason.length > 500) {
      throw new BadRequestException('Gecersiz chargeback bilgileri');
    }

    if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(input.disputedAmount ?? '')) {
      throw new BadRequestException('Gecersiz tutar');
    }

    const amount = new Prisma.Decimal(input.disputedAmount);
    if (amount.lte(0)) {
      throw new BadRequestException('Itiraz tutari sifirdan buyuk olmali');
    }

    const notifiedAt = new Date(input.notifiedAt);
    const responseDueAt = input.responseDueAt
      ? new Date(input.responseDueAt)
      : null;

    if (Number.isNaN(notifiedAt.getTime()) ||
        (responseDueAt && Number.isNaN(responseDueAt.getTime())) ||
        (responseDueAt && responseDueAt < notifiedAt)) {
      throw new BadRequestException('Gecersiz itiraz tarihi');
    }

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          totalAmount: true,
          iyzicoPaymentId: true,
          iyzicoPaidAt: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Siparis bulunamadi');
      }

      if (!order.iyzicoPaymentId || !order.iyzicoPaidAt) {
        throw new BadRequestException('Dogrulanmis iyzico odemesi yok');
      }

      const success = await tx.paymentAttempt.findFirst({
        where: {
          orderId,
          provider: PaymentProvider.IYZICO,
          status: PaymentStatus.SUCCESS,
          iyzicoPaymentId: order.iyzicoPaymentId,
          callbackVerifiedAt: { not: null },
        },
        select: { id: true },
      });

      if (!success) {
        throw new BadRequestException('Basarili iyzico tahsilati dogrulanamadi');
      }

      if (amount.gt(order.totalAmount)) {
        throw new BadRequestException('Itiraz tutari siparis tutarini asamaz');
      }

      const paymentTransaction = await tx.paymentTransaction.findUnique({
        where: { orderId },
        select: {
          amount: true,
          iyzicoRefundedAmount: true,
        },
      });

      if (!paymentTransaction) {
        throw new BadRequestException(
          'Odeme islem kaydi bulunamadi; finansal inceleme gerekli',
        );
      }

      if (amount.gt(paymentTransaction.amount)) {
        throw new BadRequestException(
          'Itiraz tutari kayitli odeme tutarini asamaz',
        );
      }

      if (
        paymentTransaction.iyzicoRefundedAmount.lt(0) ||
        paymentTransaction.iyzicoRefundedAmount.gt(paymentTransaction.amount)
      ) {
        throw new BadRequestException(
          'Iade tutari tutarsiz; finansal inceleme gerekli',
        );
      }

      const record = await tx.chargebackCase.create({
        data: {
          orderId,
          createdById: actor.id,
          provider: PaymentProvider.IYZICO,
          providerReference: reference,
          iyzicoPaymentId: order.iyzicoPaymentId,
          disputedAmount: amount,
          reason,
          description: input.description?.trim() || null,
          notifiedAt,
          responseDueAt,
        },
        select: {
          id: true,
          orderId: true,
          status: true,
          createdAt: true,
        },
      });

      await tx.chargebackEvent.create({
        data: {
          chargebackId: record.id,
          actorId: actor.id,
          action: 'CREATED',
          nextStatus: 'OPEN',
          note: 'Banka itirazi kaydi olusturuldu',
        },
      });

      return record;
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002') {
        throw new ConflictException('Banka itiraz referansi zaten kayitli');
      }
      throw error;
    });
  }
}
