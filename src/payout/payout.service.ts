import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerType, PayoutStatus, Prisma, Role } from '@prisma/client';

@Injectable()
export class PayoutService {
  constructor(private prisma: PrismaService) {}

  // ✅ Wallet yoksa oluştur (güvenli)
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

  // ✅ SELLER -> kendi balance
  async getMyBalance(user: any) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER kendi bakiyesini görebilir');
    }

    await this.ensureWallet(user.companyId);

    const wallet = await this.prisma.companyWallet.findUnique({
      where: { companyId: user.companyId },
    });

    return {
      message: 'balance ok',
      companyId: user.companyId,
      wallet,
    };
  }

  // ✅ SELLER -> payout request (PENDING payout'ları listeler)
  async request(user: any) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER payout talep edebilir');
    }

    await this.ensureWallet(user.companyId);

    const payouts = await this.prisma.payout.findMany({
      where: { sellerId: user.companyId, status: PayoutStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      include: { order: true },
    });

    // Ledger event (opsiyonel): payout talebi logla
    // (İstersen her request'te tek kayıt üretmemek için kontrol koyabiliriz)
    await this.prisma.ledgerEntry.create({
      data: {
        type: LedgerType.PAYOUT_REQUEST,
        amount: new Prisma.Decimal(0),
        currency: 'TRY',
        note: 'Seller requested payout list',
        fromCompanyId: user.companyId,
        meta: { sellerId: user.companyId, pendingCount: payouts.length },
      },
    });

    return { message: 'payout request ok', payouts };
  }

  // ✅ ADMIN -> list payouts
  async list(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN payout listeleyebilir');
    }

    return this.prisma.payout.findMany({
      orderBy: { createdAt: 'desc' },
      include: { seller: true, order: true },
    });
  }

  // ✅ ADMIN -> approve payout
  async approve(user: any, payoutId: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN approve yapabilir');
    }

    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { order: true },
    });
    if (!payout) throw new NotFoundException('Payout not found');
    if (!payout.order) throw new NotFoundException('Order not found');

    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Bu payout zaten işlenmiş');
    }

    // Güvenlik: escrow release edilmeden payout approve olmasın
    if (payout.order.escrowReleased !== true) {
      throw new BadRequestException(
        'Escrow release edilmeden payout approve edilemez',
      );
    }

    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      // 1) payout -> PAID
      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: {
          status: PayoutStatus.PAID,
          processedAt: now,
          note: payout.note ?? null,
        },
      });

      // 2) ledger: PAYOUT_APPROVE
      await tx.ledgerEntry.create({
        data: {
          orderId: payout.orderId,
          type: LedgerType.PAYOUT_APPROVE,
          amount: payout.amount,
          currency: 'TRY',
          note: 'Payout approved and processed',
          meta: { payoutId: payout.id, sellerId: payout.sellerId },
        },
      });

      return { message: 'payout approved', payout: updated };
    });
  }

  // ✅ ADMIN -> reject payout
  // (Enum’da REJECTED yok; not’a yazıyoruz, status PENDING kalır. İstersen schema'ya REJECTED ekleriz.)
  async reject(user: any, payoutId: string, note?: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN reject yapabilir');
    }

    const payout = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      include: { order: true },
    });
    if (!payout) throw new NotFoundException('Payout not found');

    if (payout.status !== PayoutStatus.PENDING) {
      throw new BadRequestException('Bu payout zaten işlenmiş');
    }

    const now = new Date();
    const finalNote = note?.trim() ? `REJECTED: ${note.trim()}` : 'REJECTED';

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: {
          processedAt: now,
          note: finalNote,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: payout.orderId,
          type: LedgerType.PAYOUT_REJECT,
          amount: payout.amount,
          currency: 'TRY',
          note: finalNote,
          meta: { payoutId: payout.id, sellerId: payout.sellerId },
        },
      });

      return { message: 'payout rejected', payout: updated };
    });
  }
}