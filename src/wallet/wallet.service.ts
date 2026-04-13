import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async getOrCreate(companyId: string) {
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

  async getMine(user: any) {
    const wallet = await this.getOrCreate(user.companyId);
    return { wallet };
  }

  // ✅ Admin test için bakiye yükle/indir
  async adminAdjust(user: any, companyId: string, amount: number, note?: string) {
    if (user.role !== Role.ADMIN) throw new ForbiddenException('Sadece ADMIN');

    if (typeof amount !== 'number' || Number.isNaN(amount)) {
      throw new BadRequestException('amount number olmalı');
    }
    const dec = new Prisma.Decimal(amount);
    if (dec.lte(0)) throw new BadRequestException('amount > 0 olmalı');

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    return this.prisma.$transaction(async (tx) => {
      const w = await tx.companyWallet.upsert({
        where: { companyId },
        create: { companyId, available: new Prisma.Decimal(0), locked: new Prisma.Decimal(0) },
        update: {},
      });

      const updated = await tx.companyWallet.update({
        where: { companyId },
        data: { available: w.available.add(dec) },
      });

      await tx.ledgerEntry.create({
        data: {
          type: 'ADJUSTMENT',
          orderId: null,
          disputeId: null,
          fromCompanyId: null,
          toCompanyId: companyId,
          amount: dec,
          currency: 'TRY',
          note: note ?? 'Admin wallet top-up',
          meta: { action: 'WALLET_CREDIT' },
        },
      });

      return { message: 'wallet adjusted', wallet: updated };
    });
  }

  // ✅ Buyer pay: available -> locked
  async moveAvailableToLocked(tx: Prisma.TransactionClient, companyId: string, amount: Prisma.Decimal, meta?: any) {
    const w = await tx.companyWallet.upsert({
      where: { companyId },
      create: { companyId, available: new Prisma.Decimal(0), locked: new Prisma.Decimal(0) },
      update: {},
    });

    if (w.available.lt(amount)) throw new BadRequestException('Yetersiz bakiye');

    return tx.companyWallet.update({
      where: { companyId },
      data: {
        available: w.available.sub(amount),
        locked: w.locked.add(amount),
      },
    });
  }

  // ✅ Escrow release/refund: locked -> available
  async moveLockedToAvailable(tx: Prisma.TransactionClient, companyId: string, amount: Prisma.Decimal) {
    const w = await tx.companyWallet.upsert({
      where: { companyId },
      create: { companyId, available: new Prisma.Decimal(0), locked: new Prisma.Decimal(0) },
      update: {},
    });

    if (w.locked.lt(amount)) throw new BadRequestException('Locked bakiye yetersiz');

    return tx.companyWallet.update({
      where: { companyId },
      data: {
        locked: w.locked.sub(amount),
        available: w.available.add(amount),
      },
    });
  }

  // ✅ Payout approve: seller available düş (çekim)
  async decreaseAvailable(tx: Prisma.TransactionClient, companyId: string, amount: Prisma.Decimal) {
    const w = await tx.companyWallet.upsert({
      where: { companyId },
      create: { companyId, available: new Prisma.Decimal(0), locked: new Prisma.Decimal(0) },
      update: {},
    });

    if (w.available.lt(amount)) throw new BadRequestException('Seller available yetersiz');

    return tx.companyWallet.update({
      where: { companyId },
      data: { available: w.available.sub(amount) },
    });
  }
}