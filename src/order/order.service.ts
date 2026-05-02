import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerType, OrderStatus, Prisma, Role } from '@prisma/client';

@Injectable()
export class OrderService {
  constructor(private prisma: PrismaService) {}

  // Wallet yoksa oluştur
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

  // BUYER -> Quote kabul eder ve order oluşturur
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

    const commissionAmount = totalAmount.mul(new Prisma.Decimal(0.05));
    const escrowAmount = totalAmount;
    const payoutAmount = totalAmount.minus(commissionAmount);

    return this.prisma.$transaction(async (tx) => {
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

      // Seçilen teklifi ACCEPTED yap
      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: 'ACCEPTED',
        },
      });

      // Aynı RFQ üzerindeki diğer teklifleri REJECTED yap
      await tx.quote.updateMany({
        where: {
          rfqId: quote.rfqId,
          id: { not: quote.id },
        },
        data: {
          status: 'REJECTED',
        },
      });

      // RFQ'yu kapat
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
  }

  // ORDER LIST
  async list(user: any) {
    const includeRelations = {
      rfq: {
        include: {
          product: true,
        },
      },
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

  // ORDER DETAIL
  async getOne(user: any, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        rfq: {
          include: {
            product: true,
          },
        },
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

  // BUYER ödeme
  async pay(user: any, orderId: string) {
    if (user.role !== Role.BUYER) {
      throw new ForbiddenException('Sadece BUYER ödeme yapabilir');
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
      throw new BadRequestException('Order ödeme beklemiyor');
    }

    const escrowAmount = new Prisma.Decimal(order.escrowAmount);

    if (escrowAmount.lte(0)) {
      throw new BadRequestException('Escrow amount 0 olamaz');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.ensureWallet(tx, order.buyerId);
      await this.ensureWallet(tx, order.sellerId);

      const buyerWallet = await tx.companyWallet.findUnique({
        where: { companyId: order.buyerId },
      });

      if (!buyerWallet) {
        throw new NotFoundException('Buyer wallet not found');
      }

      const buyerAvailable = new Prisma.Decimal(buyerWallet.available);

      if (buyerAvailable.lt(escrowAmount)) {
        throw new BadRequestException('Yetersiz bakiye');
      }

      await tx.companyWallet.update({
        where: { companyId: order.buyerId },
        data: {
          available: { decrement: escrowAmount },
          locked: { increment: escrowAmount },
        },
      });

      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.PAID },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          type: LedgerType.ESCROW_DEPOSIT,
          amount: escrowAmount,
          currency: 'TRY',
          note: 'Buyer payment deposited into escrow',
        },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          type: LedgerType.COMMISSION,
          amount: order.commissionAmount,
          currency: 'TRY',
          note: 'Platform commission reserved',
        },
      });

      return {
        message: 'Payment successful',
        order: updatedOrder,
      };
    });
  }

  // SELLER hazırlık
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
      throw new BadRequestException('Order PAID değil');
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PREPARING },
    });

    return {
      message: 'Order marked as PREPARING',
      order: updated,
    };
  }

  // SELLER kargoya verir
  async ship(user: any, orderId: string) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER kargoya verebilir');
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
      throw new BadRequestException('Order PREPARING değil');
    }

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.SHIPPED },
    });

    return {
      message: 'Order marked as SHIPPED',
      order: updated,
    };
  }

  // BUYER teslim aldı
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
      throw new BadRequestException('Order SHIPPED değil');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.ensureWallet(tx, order.buyerId);
      await this.ensureWallet(tx, order.sellerId);

      const updated = await tx.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.COMPLETED },
      });

      const escrowAmount = new Prisma.Decimal(order.escrowAmount);
      const payoutAmount = new Prisma.Decimal(order.payoutAmount);

      await tx.companyWallet.update({
        where: { companyId: order.buyerId },
        data: {
          locked: { decrement: escrowAmount },
        },
      });

      await tx.companyWallet.update({
        where: { companyId: order.sellerId },
        data: {
          available: { increment: payoutAmount },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          type: LedgerType.ESCROW_RELEASE_SELLER,
          amount: payoutAmount,
          currency: 'TRY',
          note: 'Escrow released to seller after commission deduction',
        },
      });

      return {
        message: 'Order completed and escrow released',
        order: updated,
      };
    });
  }
}