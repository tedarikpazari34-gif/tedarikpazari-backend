import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RfqService {
  constructor(private prisma: PrismaService) {}

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

    return this.prisma.rFQ.create({
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