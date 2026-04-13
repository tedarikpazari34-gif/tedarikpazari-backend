import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, LedgerType, PayoutStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminFinanceService {
  constructor(private prisma: PrismaService) {}

  // ADMIN: ledger list
  async listLedger(user: any, take = 50) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN');
    }

    return this.prisma.ledgerEntry.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      include: { order: true },
    });
  }

  // ADMIN: seller balance snapshot
  async getSellerBalance(user: any, sellerId: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN');
    }

    // 1) Seller'ın "earned" ettiği (escrow release) toplam
    const earnedAgg = await this.prisma.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: {
        type: LedgerType.ESCROW_RELEASE_SELLER,
        order: { sellerId },
      },
    });
    const earned = earnedAgg._sum.amount ?? new Prisma.Decimal(0);

    // 2) Seller'a "paid out" (payout approve ile ödenmiş) toplam
    const paidAgg = await this.prisma.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: {
        type: LedgerType.PAYOUT_APPROVE,
        order: { sellerId },
      },
    });
    const paidOut = paidAgg._sum.amount ?? new Prisma.Decimal(0);

    // 3) Pending payout toplamı (henüz admin approve etmemiş)
    const pendingAgg = await this.prisma.payout.aggregate({
      _sum: { amount: true },
      where: {
        sellerId,
        status: PayoutStatus.PENDING,
      },
    });
    const pendingPayout = pendingAgg._sum.amount ?? new Prisma.Decimal(0);

    // 4) Adjustment net (opsiyonel): toCompanyId - fromCompanyId
    const adjToAgg = await this.prisma.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: {
        type: LedgerType.ADJUSTMENT,
        toCompanyId: sellerId,
      },
    });
    const adjTo = adjToAgg._sum.amount ?? new Prisma.Decimal(0);

    const adjFromAgg = await this.prisma.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: {
        type: LedgerType.ADJUSTMENT,
        fromCompanyId: sellerId,
      },
    });
    const adjFrom = adjFromAgg._sum.amount ?? new Prisma.Decimal(0);

    const adjustmentNet = adjTo.sub(adjFrom);

    // 5) Withdrawable = earned + adjNet - paidOut - pending
    const withdrawable = earned.add(adjustmentNet).sub(paidOut).sub(pendingPayout);

    return {
      sellerId,
      earned: earned.toString(),
      paidOut: paidOut.toString(),
      pendingPayout: pendingPayout.toString(),
      adjustmentNet: adjustmentNet.toString(),
      withdrawable: withdrawable.toString(),
    };
  }
}