import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class FavoriteService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureBuyer(user: any) {
    if (!user?.id) {
      throw new ForbiddenException('Giriş yapmalısınız');
    }

    if (user.role !== Role.BUYER) {
      throw new ForbiddenException(
        'Favoriler özelliğini yalnızca alıcı hesapları kullanabilir',
      );
    }
  }

  async list(user: any) {
    this.ensureBuyer(user);

    const favorites = await this.prisma.favorite.findMany({
      where: {
        userId: user.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        product: {
          include: {
            category: true,
            images: {
              orderBy: {
                sortOrder: 'asc',
              },
            },
            seller: {
              select: {
                id: true,
                name: true,
                verified: true,
                rating: true,
                reviewCount: true,
                city: true,
              },
            },
          },
        },
      },
    });

    return favorites.map((favorite) => ({
      id: favorite.id,
      createdAt: favorite.createdAt,
      product: favorite.product,
    }));
  }

  async ids(user: any) {
    this.ensureBuyer(user);

    const favorites = await this.prisma.favorite.findMany({
      where: {
        userId: user.id,
      },
      select: {
        productId: true,
      },
    });

    return favorites.map((favorite) => favorite.productId);
  }

  async add(user: any, productId: string) {
    this.ensureBuyer(user);

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        isActive: true,
        isApproved: true,
      },
      select: {
        id: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    const favorite = await this.prisma.favorite.upsert({
      where: {
        userId_productId: {
          userId: user.id,
          productId,
        },
      },
      create: {
        userId: user.id,
        productId,
      },
      update: {},
    });

    return {
      message: 'Ürün favorilere eklendi',
      favorite,
    };
  }

  async remove(user: any, productId: string) {
    this.ensureBuyer(user);

    await this.prisma.favorite.deleteMany({
      where: {
        userId: user.id,
        productId,
      },
    });

    return {
      message: 'Ürün favorilerden çıkarıldı',
      productId,
    };
  }
}
