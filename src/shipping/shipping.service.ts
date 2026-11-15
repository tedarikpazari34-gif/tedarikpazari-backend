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
    if (!user || this.role(user) !== 'BUYER' || !user.companyId) {
      throw new ForbiddenException('Sadece BUYER nakliye talebi oluşturabilir');
    }

    if (!body?.orderId) {
      throw new NotFoundException('orderId zorunlu');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: body.orderId },
      select: {
        buyerId: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Sipariş bulunamadı');
    }

    if (order.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu sipariş size ait değil');
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

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Order"
        WHERE "id" = ${body.orderId}
        FOR UPDATE
      `;

      if (!locked.length) {
        throw new NotFoundException('Sipariş bulunamadı');
      }

      const existing = await tx.shippingRFQ.findFirst({
        where: { orderId: body.orderId },
        select: { id: true },
      });

      if (existing) {
        throw new ForbiddenException(
          'Bu sipariş için nakliye talebi zaten oluşturulmuş.',
        );
      }

      return tx.shippingRFQ.create({
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

        deliveryExpectation:
          String(body.deliveryExpectation || '').trim() || null,

        isFragile: Boolean(body.isFragile),
        isDangerous: Boolean(body.isDangerous),
        coldChain: Boolean(body.coldChain),
        stackable:
          body.stackable === undefined
            ? true
            : Boolean(body.stackable),
        needForklift: Boolean(body.needForklift),
        needCrane: Boolean(body.needCrane),

        photoUrl:
          String(body.photoUrl || '').trim() || null,

        note: body.note ?? null,
        status: 'OPEN',
      },
      select: {
        id: true,
        orderId: true,
        status: true,
        createdAt: true,
      },
      });
    });
  }

  async listOpen(user: any) {
    if (!user || this.role(user) !== 'LOGISTICS' || !user.companyId) {
      throw new ForbiddenException('Sadece doğrulanmış lojistik firmaları görebilir');
    }

    return this.prisma.shippingRFQ.findMany({
      where: { status: 'OPEN' },
      select: {
        id: true,
        status: true,
        fromCity: true,
        fromDistrict: true,
        toCity: true,
        toDistrict: true,
        palletCount: true,
        packageCount: true,
        weight: true,
        volume: true,
        vehicleType: true,
        loadingDate: true,
        requestedDeliveryDate: true,
        deliveryExpectation: true,
        isFragile: true,
        isDangerous: true,
        coldChain: true,
        stackable: true,
        needForklift: true,
        needCrane: true,
        order: {
          select: {
            rfq: {
              select: {
                product: {
                  select: { title: true },
                },
              },
            },
          },
        },
        _count: {
          select: { quotes: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async sendQuote(user: any, body: any) {
    if (!user || this.role(user) !== 'LOGISTICS' || !user.companyId) {
      throw new ForbiddenException('Sadece LOGISTICS teklif verebilir');
    }

    if (typeof body?.rfqId !== 'string' || !body.rfqId.trim()) {
      throw new NotFoundException('rfqId zorunlu');
    }

    return this.prisma.$transaction(async (tx) => {
      // Aynı RFQ için eşzamanlı teklifleri sıraya al.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "ShippingRFQ"
        WHERE "id" = ${body.rfqId}
        FOR UPDATE
      `;

      if (!locked.length) {
        throw new NotFoundException('Nakliye talebi bulunamadı');
      }

      const shippingRfq = await tx.shippingRFQ.findUnique({
        where: { id: body.rfqId },
        select: { status: true },
      });

      if (!shippingRfq) {
        throw new NotFoundException('Nakliye talebi bulunamadı');
      }

      if (shippingRfq.status !== 'OPEN') {
        throw new ForbiddenException('Talep açık değil');
      }

      const existingQuote = await tx.shippingQuote.findFirst({
        where: {
          rfqId: body.rfqId,
          companyId: user.companyId,
        },
        select: { id: true },
      });

      if (existingQuote) {
        throw new ForbiddenException('Zaten teklif verdiniz');
      }

      return tx.shippingQuote.create({
        data: {
          rfqId: body.rfqId,
          companyId: user.companyId,
          price: Number(body.price),
          deliveryDays: Number(body.deliveryDays),
          note: body.note ?? null,
          status: 'SENT',
        },
        select: {
          id: true,
          status: true,
        },
      });
    });
  }

  async listQuotesForBuyer(user: any) {
    if (!user || this.role(user) !== 'BUYER' || !user.companyId) {
      throw new ForbiddenException('Sadece BUYER görebilir');
    }

    return this.prisma.shippingQuote.findMany({
      where: {
        rfq: {
          buyerId: user.companyId,
        },
      },
      select: {
        id: true,
        status: true,
        price: true,
        deliveryDays: true,
        note: true,
        rfq: {
          select: {
            order: {
              select: {
                rfq: {
                  select: {
                    product: {
                      select: {
                        title: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async acceptQuote(user: any, quoteId: string) {
    if (!user || this.role(user) !== 'BUYER' || !user.companyId) {
      throw new ForbiddenException('Sadece BUYER seçebilir');
    }

    const quote = await this.prisma.shippingQuote.findUnique({
      where: { id: quoteId },
      select: {
        id: true,
        rfqId: true,
        companyId: true,
        rfq: {
          select: {
            id: true,
            buyerId: true,
            orderId: true,
            status: true,
            order: {
              select: {
                sellerId: true,
              },
            },
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
      const claimed = await tx.shippingRFQ.updateMany({
        where: {
          id: quote.rfqId,
          buyerId: user.companyId,
          status: 'OPEN',
        },
        data: { status: 'CLOSED' },
      });

      if (claimed.count !== 1) {
        throw new BadRequestException(
          'Nakliye talebi zaten kapatılmış. Sayfayı yenileyin.',
        );
      }

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

const shippingOrder = await tx.shippingOrder.create({
  data: {
    shippingRfqId: quote.rfq.id,
    shippingQuoteId: quote.id,
    buyerId: quote.rfq.buyerId,
    sellerId: quote.rfq.order.sellerId,
    logisticsId: quote.companyId,
    orderId: quote.rfq.orderId,
    status: 'PENDING_PICKUP',
    shippingCompany: 'Lojistik Firması',
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
  shippingOrderId: shippingOrder.id,
  chatThreadId: chatThread.id,
};
    });
  }
  async listShippingOrders(user: any) {
    const role = this.role(user);

    if (
      !user?.companyId ||
      !['LOGISTICS', 'BUYER', 'SELLER'].includes(role)
    ) {
      throw new ForbiddenException('Yetkisiz');
    }

    const where =
      role === 'LOGISTICS'
        ? { logisticsId: user.companyId }
        : role === 'BUYER'
          ? { buyerId: user.companyId }
          : { sellerId: user.companyId };

    return this.prisma.shippingOrder.findMany({
      where,
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        pickedUpAt: true,
        shippedAt: true,
        deliveredAt: true,
        trackingNo: true,
        shippingQuoteId: true,
        shippingQuote: {
          select: {
            id: true,
            price: true,
            deliveryDays: true,
          },
        },
        shippingRfq: {
          select: {
            fromAddress: role === 'LOGISTICS' || role === 'SELLER',
            toAddress: role === 'LOGISTICS' || role === 'BUYER',
            fromCity: true,
            fromDistrict: true,
            toCity: true,
            toDistrict: true,
          },
        },
        order: {
          select: {
            rfq: {
              select: {
                product: {
                  select: { title: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async pickup(user: any, id: string) {
    if (!user || this.role(user) !== 'LOGISTICS' || !user.companyId) {
      throw new ForbiddenException('Sadece LOGISTICS yük alabilir');
    }

    const order = await this.prisma.shippingOrder.findUnique({
      where: { id },
      select: {
        logisticsId: true,
        status: true,
      },
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
      select: {
        id: true,
        status: true,
        trackingNo: true,
        pickedUpAt: true,
        shippedAt: true,
        deliveredAt: true,
      },
    });
  }

  async transit(user: any, id: string) {
    if (!user || this.role(user) !== 'LOGISTICS' || !user.companyId) {
      throw new ForbiddenException('Sadece LOGISTICS yola çıkarabilir');
    }

    const order = await this.prisma.shippingOrder.findUnique({
      where: { id },
      select: {
        logisticsId: true,
        status: true,
      },
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
      select: {
        id: true,
        status: true,
        trackingNo: true,
        pickedUpAt: true,
        shippedAt: true,
        deliveredAt: true,
      },
    });
  }

  async deliver(user: any, id: string) {
    if (!user || this.role(user) !== 'LOGISTICS' || !user.companyId) {
      throw new ForbiddenException('Sadece LOGISTICS teslim edebilir');
    }

    const order = await this.prisma.shippingOrder.findUnique({
      where: { id },
      select: {
        logisticsId: true,
        status: true,
      },
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
      select: {
        id: true,
        status: true,
        trackingNo: true,
        pickedUpAt: true,
        shippedAt: true,
        deliveredAt: true,
      },
    });
  }

  }

  