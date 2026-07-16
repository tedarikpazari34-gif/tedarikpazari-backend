import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatThreadType } from '@prisma/client';


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
    const existing = await this.prisma.shippingRFQ.findFirst({
  where: {
    orderId: body.orderId,
  },
});

if (existing) {
  throw new ForbiddenException(
    'Bu sipariş için nakliye talebi zaten oluşturulmuş.',
  );
}

    const fromCity = String(body.fromCity || '').trim();
    const fromDistrict = String(body.fromDistrict || '').trim();
    const fromOpenAddress = String(body.fromOpenAddress || '').trim();

    const toCity = String(body.toCity || '').trim();
    const toDistrict = String(body.toDistrict || '').trim();
    const toOpenAddress = String(body.toOpenAddress || '').trim();

    if (!fromCity || !toCity) {
      throw new BadRequestException(
        'Çıkış ve varış şehirleri zorunludur',
      );
    }

    if (!fromDistrict || !toDistrict) {
      throw new BadRequestException(
        'Çıkış ve varış ilçeleri zorunludur',
      );
    }

    if (!fromOpenAddress || !toOpenAddress) {
      throw new BadRequestException(
        'Yükleme ve teslimat açık adresleri zorunludur',
      );
    }

    if (fromCity === toCity && fromDistrict === toDistrict) {
      throw new BadRequestException(
        'Çıkış ve varış noktaları aynı olamaz',
      );
    }

    const palletCount =
      body.palletCount === null ||
      body.palletCount === undefined ||
      body.palletCount === ''
        ? null
        : Number(body.palletCount);

    const packageCount =
      body.packageCount === null ||
      body.packageCount === undefined ||
      body.packageCount === ''
        ? null
        : Number(body.packageCount);

    if (palletCount !== null && (!Number.isInteger(palletCount) || palletCount < 0)) {
      throw new BadRequestException('Palet sayısı geçersiz');
    }

    if (packageCount !== null && (!Number.isInteger(packageCount) || packageCount < 0)) {
      throw new BadRequestException('Koli sayısı geçersiz');
    }

    const loadingDate = body.loadingDate
      ? new Date(body.loadingDate)
      : null;

    const requestedDeliveryDate = body.requestedDeliveryDate
      ? new Date(body.requestedDeliveryDate)
      : null;

    if (loadingDate && Number.isNaN(loadingDate.getTime())) {
      throw new BadRequestException('Yükleme tarihi geçersiz');
    }

    if (
      requestedDeliveryDate &&
      Number.isNaN(requestedDeliveryDate.getTime())
    ) {
      throw new BadRequestException(
        'İstenen teslim tarihi geçersiz',
      );
    }

    if (
      loadingDate &&
      requestedDeliveryDate &&
      requestedDeliveryDate < loadingDate
    ) {
      throw new BadRequestException(
        'Teslim tarihi yükleme tarihinden önce olamaz',
      );
    }

    const fromAddress = [
      fromCity,
      fromDistrict,
      fromOpenAddress,
    ]
      .filter(Boolean)
      .join(' / ');

    const toAddress = [
      toCity,
      toDistrict,
      toOpenAddress,
    ]
      .filter(Boolean)
      .join(' / ');

    return this.prisma.shippingRFQ.create({
      data: {
        orderId: body.orderId,
        buyerId: user.companyId,

        fromAddress,
        toAddress,

        fromCity,
        fromDistrict,
        fromOpenAddress,

        toCity,
        toDistrict,
        toOpenAddress,

        palletCount,
        packageCount,

        weight:
          body.weight === null ||
          body.weight === undefined ||
          body.weight === ''
            ? null
            : Number(body.weight),

        volume:
          body.volume === null ||
          body.volume === undefined ||
          body.volume === ''
            ? null
            : Number(body.volume),

        vehicleType:
          String(body.vehicleType || '').trim() || null,

        loadingDate,
        requestedDeliveryDate,

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
    company: true,
    rfq: {
      include: {
        order: true,
      },
    },
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

const shippingOrder = await tx.shippingOrder.create({
  data: {
    shippingRfqId: quote.rfq.id,
    shippingQuoteId: quote.id,
    buyerId: quote.rfq.buyerId,
    sellerId: quote.rfq.order.sellerId,
    logisticsId: quote.companyId,
    orderId: quote.rfq.orderId,
    status: 'PENDING_PICKUP',
    shippingCompany: quote.company?.name || 'Lojistik Firması',
    trackingNo: `LGT-${Date.now()}`,
  },
});

// Alıcı, satıcı ve seçilen lojistik firması için özel nakliye sohbeti oluştur.
let chatThread = await tx.chatThread.findUnique({
  where: {
    shippingOrderId: shippingOrder.id,
  },
});

if (!chatThread) {
  chatThread = await tx.chatThread.create({
    data: {
      type: ChatThreadType.SHIPPING,
      orderId: quote.rfq.orderId,
      shippingOrderId: shippingOrder.id,
      buyerId: quote.rfq.buyerId,
      sellerId: quote.rfq.order.sellerId,
      logisticsId: quote.companyId,
    },
  });
}

return {
  message:
    'Nakliye firması seçildi, taşıma siparişi ve üç taraflı lojistik sohbeti oluşturuldu',
  shippingOrder,
  chatThread,
};
    });
  }
  async listShippingOrders(user: any) {
    const role = this.role(user);

    if (role === 'LOGISTICS') {
      return this.prisma.shippingOrder.findMany({
        where: { logisticsId: user.companyId },
        include: {
          order: {
            include: {
              rfq: { include: { product: true } },
              buyer: true,
              seller: true,
            },
          },
          shippingRfq: true,
          shippingQuote: true,
          buyer: true,
          seller: true,
          logistics: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (role === 'BUYER') {
      return this.prisma.shippingOrder.findMany({
        where: { buyerId: user.companyId },
        include: {
          order: {
            include: {
              rfq: { include: { product: true } },
              buyer: true,
              seller: true,
            },
          },
          shippingRfq: true,
          shippingQuote: true,
          buyer: true,
          seller: true,
          logistics: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (role === 'SELLER') {
      return this.prisma.shippingOrder.findMany({
        where: { sellerId: user.companyId },
        include: {
          order: {
            include: {
              rfq: { include: { product: true } },
              buyer: true,
              seller: true,
            },
          },
          shippingRfq: true,
          shippingQuote: true,
          buyer: true,
          seller: true,
          logistics: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    throw new ForbiddenException('Yetkisiz');
  }

  async pickup(user: any, id: string) {
    if (this.role(user) !== 'LOGISTICS') {
      throw new ForbiddenException('Sadece LOGISTICS yük alabilir');
    }

    const order = await this.prisma.shippingOrder.findUnique({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException('Nakliye siparişi bulunamadı');
    }

    if (order.logisticsId !== user.companyId) {
      throw new ForbiddenException('Bu nakliye siparişi size ait değil');
    }

    if (order.status !== 'PENDING_PICKUP') {
      throw new ForbiddenException(`Durum uygun değil: ${order.status}`);
    }

    return this.prisma.shippingOrder.update({
      where: { id },
      data: {
        status: 'PICKED_UP',
        pickedUpAt: new Date(),
      },
    });
  }

  async transit(user: any, id: string) {
    if (this.role(user) !== 'LOGISTICS') {
      throw new ForbiddenException('Sadece LOGISTICS yola çıkarabilir');
    }

    const order = await this.prisma.shippingOrder.findUnique({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException('Nakliye siparişi bulunamadı');
    }

    if (order.logisticsId !== user.companyId) {
      throw new ForbiddenException('Bu nakliye siparişi size ait değil');
    }

    if (order.status !== 'PICKED_UP') {
      throw new ForbiddenException(`Durum uygun değil: ${order.status}`);
    }

    return this.prisma.shippingOrder.update({
      where: { id },
      data: {
        status: 'IN_TRANSIT',
        shippedAt: new Date(),
      },
    });
  }

  async deliver(user: any, id: string) {
    if (this.role(user) !== 'LOGISTICS') {
      throw new ForbiddenException('Sadece LOGISTICS teslim edebilir');
    }

    const order = await this.prisma.shippingOrder.findUnique({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException('Nakliye siparişi bulunamadı');
    }

    if (order.logisticsId !== user.companyId) {
      throw new ForbiddenException('Bu nakliye siparişi size ait değil');
    }

    if (order.status !== 'IN_TRANSIT') {
      throw new ForbiddenException(`Durum uygun değil: ${order.status}`);
    }

    return this.prisma.shippingOrder.update({
      where: { id },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });
  }

  }

  