import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ShippingService {
  constructor(private prisma: PrismaService) {}

  private role(user: any) {
    return String(user?.role || '').toUpperCase();
  }

  async createRFQ(user: any, body: any) {
    if (!user || this.role(user) !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER nakliye talebi oluşturabilir');
    }

    if (!body?.orderId) {
      throw new NotFoundException('orderId zorunlu');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: body.orderId },
      include: {
        buyer: true,
        seller: true,
        rfq: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Sipariş bulunamadı');
    }

    if (order.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu sipariş size ait değil');
    }

    return this.prisma.shippingRFQ.create({
      data: {
        orderId: body.orderId,
        buyerId: user.companyId,
        fromAddress: body.fromAddress || 'İstanbul',
        toAddress: body.toAddress || 'Ankara',
        weight: body.weight ?? null,
        volume: body.volume ?? null,
        note: body.note ?? null,
        status: 'OPEN',
      },
      include: {
        order: true,
        buyer: true,
        quotes: true,
      },
    });
  }

  async listOpen(user: any) {
    if (!user || this.role(user) !== 'LOGISTICS') {
      throw new ForbiddenException(
        `Sadece LOGISTICS görebilir. Senin rolün: ${user?.role}`,
      );
    }

    return this.prisma.shippingRFQ.findMany({
      where: {
        status: 'OPEN',
      },
      include: {
        order: {
          include: {
            rfq: {
              include: {
                product: true,
              },
            },
            buyer: true,
            seller: true,
          },
        },
        buyer: true,
        quotes: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async sendQuote(user: any, body: any) {
    if (!user || this.role(user) !== 'LOGISTICS') {
      throw new ForbiddenException('Sadece LOGISTICS teklif verebilir');
    }

    if (!body?.rfqId) {
      throw new NotFoundException('rfqId zorunlu');
    }

    const shippingRfq = await this.prisma.shippingRFQ.findUnique({
      where: { id: body.rfqId },
      include: {
        quotes: true,
      },
    });

    if (!shippingRfq) {
      throw new NotFoundException('Nakliye talebi bulunamadı');
    }

    if (shippingRfq.status !== 'OPEN') {
      throw new ForbiddenException('Talep açık değil');
    }

    const existingQuote = await this.prisma.shippingQuote.findFirst({
      where: {
        rfqId: body.rfqId,
        companyId: user.companyId,
      },
    });

    if (existingQuote) {
      throw new ForbiddenException('Zaten teklif verdiniz');
    }

    return this.prisma.shippingQuote.create({
      data: {
        rfqId: body.rfqId,
        companyId: user.companyId,
        price: Number(body.price),
        deliveryDays: Number(body.deliveryDays),
        note: body.note ?? null,
        status: 'SENT',
      },
      include: {
        rfq: true,
        company: true,
      },
    });
  }

  async listQuotesForBuyer(user: any) {
    if (!user || this.role(user) !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER görebilir');
    }

    return this.prisma.shippingQuote.findMany({
      where: {
        rfq: {
          buyerId: user.companyId,
        },
      },
      include: {
        rfq: {
          include: {
            order: {
              include: {
                rfq: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
        },
        company: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async acceptQuote(user: any, quoteId: string) {
    if (!user || this.role(user) !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER seçebilir');
    }

    const quote = await this.prisma.shippingQuote.findUnique({
      where: { id: quoteId },
      include: {
        rfq: true,
      },
    });

    if (!quote) {
      throw new NotFoundException('Teklif bulunamadı');
    }

    if (quote.rfq.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu teklif size ait değil');
    }

    if (quote.rfq.status !== 'OPEN') {
      throw new ForbiddenException('RFQ kapalı');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.shippingQuote.update({
        where: { id: quoteId },
        data: { status: 'ACCEPTED' },
      });

      await tx.shippingQuote.updateMany({
        where: {
          rfqId: quote.rfqId,
          id: { not: quoteId },
        },
        data: { status: 'REJECTED' },
      });

      await tx.shippingRFQ.update({
        where: { id: quote.rfqId },
        data: { status: 'CLOSED' },
      });

      return { message: 'Nakliye firması seçildi' };
    });
  }
}