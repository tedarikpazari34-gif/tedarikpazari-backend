import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class RfqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // BUYER → RFQ oluşturur
  async create(user: any, data: any) {
    if (!user || user.role !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER RFQ oluşturabilir');
    }

    if (!data?.productId) {
      throw new BadRequestException('productId zorunlu');
    }

    if (!data?.quantity || Number(data.quantity) < 1) {
      throw new BadRequestException('quantity en az 1 olmalı');
    }

    const product = await this.prisma.product.findUnique({
      where: { id: data.productId },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    if (!product.isActive || !product.isApproved) {
      throw new BadRequestException('Ürün aktif veya onaylı değil');
    }

    if (product.rfqEnabled === false) {
      throw new BadRequestException('Bu ürün için RFQ kapalı');
    }

    const rfq = await this.prisma.rFQ.create({
      data: {
        productId: data.productId,
        buyerId: user.companyId,
        quantity: Number(data.quantity),
        note: data.note || null,
        status: 'OPEN',
      },
      include: {
        product: true,
        buyer: true,
        quotes: true,
      },
    });

    const sellerUsers = await this.prisma.user.findMany({
      where: {
        companyId: product.sellerId,
        role: 'SELLER',
      },
      select: {
        id: true,
      },
    });

    await Promise.all(
      sellerUsers.map((sellerUser) =>
        this.notificationService.createNotification({
          userId: sellerUser.id,
          type: 'NEW_RFQ',
          title: 'Yeni Alım Talebi',
          message: `${product.title} ürününüz için yeni bir alım talebi oluşturuldu.`,
          link: '/seller/rfqs',
        }),
      ),
    );

    return rfq;
  }

  // BUYER → kendi RFQ'ları
  async listMine(user: any) {
    if (!user || user.role !== 'BUYER') {
      throw new ForbiddenException(
        'Sadece BUYER kendi RFQ listesini görebilir',
      );
    }

    return this.prisma.rFQ.findMany({
      where: {
        buyerId: user.companyId,
      },
      include: {
        product: true,
        quotes: {
          include: {
            seller: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // BUYER → kendi RFQ'sunu kapatır
  async close(user: any, id: string) {
    if (!user || user.role !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER RFQ kapatabilir');
    }

    const rfq = await this.prisma.rFQ.findFirst({
      where: {
        id,
        buyerId: user.companyId,
      },
      include: {
        order: true,
      },
    });

    if (!rfq) {
      throw new NotFoundException('RFQ bulunamadı');
    }

    if (rfq.status === 'CLOSED') {
      return rfq;
    }

    if (rfq.order) {
      throw new BadRequestException(
        'Siparişe dönüşmüş RFQ ayrıca kapatılamaz',
      );
    }

    return this.prisma.rFQ.update({
      where: { id },
      data: {
        status: 'CLOSED',
      },
      include: {
        product: true,
        quotes: true,
      },
    });
  }

  // SELLER → tüm açık RFQ'lar
  async listOpen() {
    return this.prisma.rFQ.findMany({
      where: {
        status: 'OPEN',
      },
      include: {
        product: true,
        buyer: true,
        quotes: {
          include: {
            seller: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // SELLER → kendisine gelen RFQ'lar
  async listForSeller(user: any) {
    if (!user || user.role !== 'SELLER') {
      throw new ForbiddenException(
        'Sadece SELLER gelen RFQ listesini görebilir',
      );
    }

    return this.prisma.rFQ.findMany({
      where: {
        product: {
          sellerId: user.companyId,
        },
      },
      include: {
        product: true,
        buyer: true,
        quotes: {
          include: {
            seller: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}