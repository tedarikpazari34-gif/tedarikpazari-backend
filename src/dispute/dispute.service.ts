import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DisputeResolution,
  DisputeStatus,
  EscrowEventType,
  LedgerType,
  OrderStatus,
  PayoutStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@Injectable()
export class DisputeService {
  constructor(private readonly prisma: PrismaService) {}

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

  async open(user: any, orderId: string, reason: string, description?: string) {
    if (user.role !== Role.BUYER) {
      throw new ForbiddenException('Sadece BUYER dispute açabilir');
    }

    if (!reason?.trim()) {
      throw new BadRequestException('reason zorunlu');
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

    if (order.escrowReleased === true) {
      throw new BadRequestException('Escrow çözülmüş order için dispute açılamaz');
    }

    const existing = await this.prisma.dispute.findFirst({
      where: {
        orderId,
        OR: [
          { status: DisputeStatus.OPEN },
          { status: DisputeStatus.SELLER_RESPONDED },
        ],
      },
    });

    if (existing) {
      throw new BadRequestException('Bu order için zaten açık dispute var');
    }

    return this.prisma.dispute.create({
      data: {
        orderId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        reason: reason.trim(),
        description: description?.trim() || null,
        status: DisputeStatus.OPEN,
      },
    });
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
        include: { order: true },
      });
    }

    if (user.role === Role.SELLER) {
      return this.prisma.dispute.findMany({
        where: { sellerId: user.companyId },
        orderBy: { createdAt: 'desc' },
        include: { order: true },
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
      include: { order: true },
    });
  }

  async resolve(user: any, disputeId: string, body: ResolveDisputeDto) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN resolve edebilir');
    }

    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: { order: true },
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

    const escrowTypeMap: Record<DisputeResolution, EscrowEventType> = {
      RELEASE_TO_SELLER: EscrowEventType.RELEASE_TO_SELLER,
      REFUND_TO_BUYER: EscrowEventType.REFUND_TO_BUYER,
      PARTIAL_REFUND: EscrowEventType.PARTIAL_REFUND,
    };

    return this.prisma.$transaction(async (tx) => {
      await this.ensureWallet(tx, order.buyerId);
      await this.ensureWallet(tx, order.sellerId);

      const buyerWallet = await tx.companyWallet.findUnique({
        where: { companyId: order.buyerId },
      });

      if (!buyerWallet) {
        throw new NotFoundException('Buyer wallet not found');
      }

      if (new Prisma.Decimal(buyerWallet.locked).lt(escrowAmount)) {
        throw new BadRequestException('Buyer locked bakiyesi escrow için yetersiz');
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
          orderId: order.id,
          type: escrowTypeMap[resolution],
          amount: escrowAmount,
          note: adminNote ?? undefined,
        },
        update: {
          type: escrowTypeMap[resolution],
          amount: escrowAmount,
          note: adminNote ?? undefined,
        },
      });

      if (resolution === DisputeResolution.RELEASE_TO_SELLER) {
        await tx.companyWallet.update({
          where: { companyId: order.buyerId },
          data: {
            locked: { decrement: escrowAmount },
          },
        });

        await tx.companyWallet.update({
          where: { companyId: order.sellerId },
          data: {
            available: { increment: escrowAmount },
          },
        });

        await tx.ledgerEntry.create({
          data: {
            orderId: order.id,
            disputeId: dispute.id,
            type: LedgerType.ESCROW_RELEASE_SELLER,
            fromCompanyId: order.buyerId,
            toCompanyId: order.sellerId,
            amount: escrowAmount,
            currency: 'TRY',
            note: 'Dispute resolved: release to seller',
            meta: { disputeId: dispute.id },
          },
        });

        const payoutAmountNew = new Prisma.Decimal(order.payoutAmount).add(escrowAmount);

        const orderUpdated = await tx.order.update({
          where: { id: order.id },
          data: {
            escrowAmount: new Prisma.Decimal(0),
            escrowReleased: true,
            releasedAt: now,
            payoutAmount: payoutAmountNew,
            status: OrderStatus.COMPLETED,
          },
        });

        await tx.payout.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            sellerId: order.sellerId,
            amount: payoutAmountNew,
            status: PayoutStatus.PENDING,
          },
          update: {
            amount: payoutAmountNew,
            status: PayoutStatus.PENDING,
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
          where: { companyId: order.buyerId },
          data: {
            locked: { decrement: escrowAmount },
            available: { increment: escrowAmount },
          },
        });

        await tx.ledgerEntry.create({
          data: {
            orderId: order.id,
            disputeId: dispute.id,
            type: LedgerType.ESCROW_REFUND_BUYER,
            fromCompanyId: order.buyerId,
            toCompanyId: order.buyerId,
            amount: escrowAmount,
            currency: 'TRY',
            note: 'Dispute resolved: refund to buyer',
            meta: { disputeId: dispute.id },
          },
        });

        const orderUpdated = await tx.order.update({
          where: { id: order.id },
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

      const partial = body.partialRefundAmount;
      if (partial === undefined || partial === null) {
        throw new BadRequestException('partialRefundAmount zorunlu');
      }

      const refundAmount = new Prisma.Decimal(partial);
      if (refundAmount.lte(0)) {
        throw new BadRequestException('partialRefundAmount > 0 olmalı');
      }

      if (refundAmount.gte(escrowAmount)) {
        throw new BadRequestException('partialRefundAmount escrowAmount’tan küçük olmalı');
      }

      const sellerAmount = escrowAmount.sub(refundAmount);

      await tx.companyWallet.update({
        where: { companyId: order.buyerId },
        data: {
          locked: { decrement: escrowAmount },
          available: { increment: refundAmount },
        },
      });

      await tx.companyWallet.update({
        where: { companyId: order.sellerId },
        data: {
          available: { increment: sellerAmount },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          disputeId: dispute.id,
          type: LedgerType.ESCROW_REFUND_BUYER,
          fromCompanyId: order.buyerId,
          toCompanyId: order.buyerId,
          amount: refundAmount,
          currency: 'TRY',
          note: 'Dispute resolved: partial refund to buyer',
          meta: { disputeId: dispute.id, partial: true },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          disputeId: dispute.id,
          type: LedgerType.ESCROW_RELEASE_SELLER,
          fromCompanyId: order.buyerId,
          toCompanyId: order.sellerId,
          amount: sellerAmount,
          currency: 'TRY',
          note: 'Dispute resolved: remaining escrow released to seller',
          meta: { disputeId: dispute.id, partial: true },
        },
      });

      const payoutAmountNew = new Prisma.Decimal(order.payoutAmount).add(sellerAmount);

      const orderUpdated = await tx.order.update({
        where: { id: order.id },
        data: {
          escrowAmount: new Prisma.Decimal(0),
          escrowReleased: true,
          releasedAt: now,
          payoutAmount: payoutAmountNew,
          status: OrderStatus.COMPLETED,
        },
      });

      await tx.payout.upsert({
        where: { orderId: order.id },
        create: {
          orderId: order.id,
          sellerId: order.sellerId,
          amount: payoutAmountNew,
          status: PayoutStatus.PENDING,
        },
        update: {
          amount: payoutAmountNew,
          status: PayoutStatus.PENDING,
        },
      });

      return {
        message: 'dispute resolved: PARTIAL_REFUND',
        dispute: disputeUpdated,
        order: orderUpdated,
      };
    });
  }
}