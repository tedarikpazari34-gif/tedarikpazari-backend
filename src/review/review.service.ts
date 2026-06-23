import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class ReviewService {
  constructor(private prisma: PrismaService) {}

  async create(user: any, body: { orderId: string; rating: number; comment?: string }) {
    if (!user || user.role !== Role.BUYER) {
      throw new ForbiddenException('Sadece BUYER yorum yapabilir');
    }

    if (!body.orderId) {
      throw new BadRequestException('orderId zorunlu');
    }

    if (!body.rating || body.rating < 1 || body.rating > 5) {
      throw new BadRequestException('Puan 1 ile 5 arasında olmalı');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: body.orderId },
    });

    if (!order) {
      throw new NotFoundException('Sipariş bulunamadı');
    }

    if (order.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu sipariş size ait değil');
    }

    if (order.status !== 'COMPLETED') {
      throw new BadRequestException('Sadece tamamlanan siparişe yorum yapılabilir');
    }

    const existing = await this.prisma.review.findUnique({
      where: { orderId: body.orderId },
    });

    if (existing) {
      throw new BadRequestException('Bu sipariş için zaten yorum yapılmış');
    }

    return this.prisma.review.create({
      data: {
        orderId: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        rating: body.rating,
        comment: body.comment || null,
      },
    });
  }

  async getSellerReviews(sellerId: string) {
    const reviews = await this.prisma.review.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
      include: {
        buyer: true,
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
    });

    const average =
      reviews.length === 0
        ? 0
        : reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;

    return {
      average,
      count: reviews.length,
      reviews,
    };
  }
}
