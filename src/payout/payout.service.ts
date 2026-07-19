import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LedgerType, PayoutRequestStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PayoutService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  private async ensureWallet(companyId: string) {
    return this.prisma.companyWallet.upsert({
      where: { companyId },
      create: {
        companyId,
        available: new Prisma.Decimal(0),
        locked: new Prisma.Decimal(0),
      },
      update: {},
    });
  }

  async getMyBalance(user: any) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER kendi bakiyesini görebilir');
    }

    const wallet = await this.ensureWallet(user.companyId);

    return {
      message: 'balance ok',
      companyId: user.companyId,
      wallet,
    };
  }

  async request(user: any, body: { amount: number; iban: string }) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException(
        'Sadece SELLER para çekme talebi oluşturabilir',
      );
    }

    const amount = new Prisma.Decimal(body.amount || 0);
    const iban = body.iban?.trim();

    if (amount.lte(0)) {
      throw new BadRequestException('Tutar 0’dan büyük olmalı');
    }

    if (!iban || iban.length < 15) {
      throw new BadRequestException('Geçerli IBAN giriniz');
    }

    const wallet = await this.ensureWallet(user.companyId);

    if (new Prisma.Decimal(wallet.available).lt(amount)) {
      throw new BadRequestException('Yetersiz kullanılabilir bakiye');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const payoutRequest = await tx.payoutRequest.create({
        data: {
          companyId: user.companyId,
          amount,
          iban,
          status: PayoutRequestStatus.PENDING,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          type: LedgerType.PAYOUT_REQUEST,
          amount,
          currency: 'TRY',
          fromCompanyId: user.companyId,
          note: 'Seller payout request created',
          meta: {
            payoutRequestId: payoutRequest.id,
            iban,
          },
        },
      });

      return payoutRequest;
    });

    const adminUsers = await this.prisma.user.findMany({
      where: { role: Role.ADMIN },
    });

    for (const admin of adminUsers) {
      await this.notificationService.createNotification({
        userId: admin.id,
        type: 'PAYOUT',
        title: 'Yeni Para Çekme Talebi',
        message: `${amount} ₺ tutarında yeni payout talebi oluşturuldu.`,
        link: '/admin/payouts',
      });
    }

    return {
      message: 'Para çekme talebi oluşturuldu',
      payoutRequest: result,
    };
  }

  async myRequests(user: any) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER taleplerini görebilir');
    }

    return this.prisma.payoutRequest.findMany({
      where: { companyId: user.companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN payout listeleyebilir');
    }

    return this.prisma.payoutRequest.findMany({
      orderBy: { createdAt: 'desc' },
      include: { company: true },
    });
  }

  async approve(user: any, payoutRequestId: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN approve yapabilir');
    }

    const payoutRequest = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
    });

    if (!payoutRequest) {
      throw new NotFoundException('Payout request not found');
    }

    if (payoutRequest.status !== PayoutRequestStatus.PENDING) {
      throw new BadRequestException('Bu talep zaten işlenmiş');
    }

    const amount = new Prisma.Decimal(payoutRequest.amount);

    const result = await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.companyWallet.upsert({
        where: { companyId: payoutRequest.companyId },
        create: {
          companyId: payoutRequest.companyId,
          available: new Prisma.Decimal(0),
          locked: new Prisma.Decimal(0),
        },
        update: {},
      });

      if (new Prisma.Decimal(wallet.available).lt(amount)) {
        throw new BadRequestException('Seller available yetersiz');
      }

      await tx.companyWallet.update({
        where: { companyId: payoutRequest.companyId },
        data: {
          available: { decrement: amount },
        },
      });

      const updated = await tx.payoutRequest.update({
        where: { id: payoutRequest.id },
        data: {
          status: PayoutRequestStatus.APPROVED,
          processedAt: new Date(),
        },
      });

      await tx.ledgerEntry.create({
        data: {
          type: LedgerType.PAYOUT_APPROVE,
          amount,
          currency: 'TRY',
          fromCompanyId: payoutRequest.companyId,
          note: 'Payout request approved',
          meta: {
            payoutRequestId: payoutRequest.id,
          },
        },
      });

      return {
        message: 'Para çekme talebi onaylandı',
        payoutRequest: updated,
      };
    });

    const sellerUser = await this.prisma.user.findFirst({
      where: { companyId: payoutRequest.companyId },
    });

    if (sellerUser) {
      await this.notificationService.createNotification({
        userId: sellerUser.id,
        type: 'PAYMENT',
        title: 'Para Çekme Talebiniz Onaylandı',
        message: `${amount} ₺ tutarındaki para çekme talebiniz onaylandı.`,
        link: '/wallet',
      });
    }

    return result;
  }

  async reject(user: any, payoutRequestId: string, note?: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN reject yapabilir');
    }

    const payoutRequest = await this.prisma.payoutRequest.findUnique({
      where: { id: payoutRequestId },
    });

    if (!payoutRequest) {
      throw new NotFoundException('Payout request not found');
    }

    if (payoutRequest.status !== PayoutRequestStatus.PENDING) {
      throw new BadRequestException('Bu talep zaten işlenmiş');
    }

    const finalNote = note?.trim() || 'Reddedildi';

    const updated = await this.prisma.payoutRequest.update({
      where: { id: payoutRequest.id },
      data: {
        status: PayoutRequestStatus.REJECTED,
        processedAt: new Date(),
        adminNote: finalNote,
      },
    });

    await this.prisma.ledgerEntry.create({
      data: {
        type: LedgerType.PAYOUT_REJECT,
        amount: payoutRequest.amount,
        currency: 'TRY',
        fromCompanyId: payoutRequest.companyId,
        note: finalNote,
        meta: {
          payoutRequestId: payoutRequest.id,
        },
      },
    });

    const sellerUser = await this.prisma.user.findFirst({
      where: {
        companyId: payoutRequest.companyId,
      },
    });

    if (sellerUser) {
      await this.notificationService.createNotification({
        userId: sellerUser.id,
        type: 'PAYMENT',
        title: 'Para Çekme Talebiniz Reddedildi',
        message: `Para çekme talebiniz reddedildi. Sebep: ${finalNote}`,
        link: '/wallet',
      });
    }

    return {
      message: 'Para çekme talebi reddedildi',
      payoutRequest: updated,
    };
  }
}
