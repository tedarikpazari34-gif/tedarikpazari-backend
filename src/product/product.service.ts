import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Role } from '@prisma/client';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: {
    categoryId?: string;
    sellerId?: string;
    q?: string;
  }) {
    const { categoryId, sellerId, q } = query;

    let categoryFilter = {};

    if (categoryId) {
      const childCategories = await this.prisma.category.findMany({
        where: {
          parentId: categoryId,
        },
        select: {
          id: true,
        },
      });

      const categoryIds = [categoryId, ...childCategories.map((c) => c.id)];

      categoryFilter = {
        categoryId: {
          in: categoryIds,
        },
      };
    }

    return this.prisma.product.findMany({
      where: {
        isActive: true,
        isApproved: true,
        ...categoryFilter,
        ...(q
          ? {
              title: {
                contains: q,
              },
            }
          : {}),
        ...(sellerId ? { sellerId } : {}),
      },
      include: {
        category: true,
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByCategory(categoryId: string) {
    const childCategories = await this.prisma.category.findMany({
      where: {
        parentId: categoryId,
      },
      select: {
        id: true,
      },
    });

    const categoryIds = [categoryId, ...childCategories.map((c) => c.id)];

    return this.prisma.product.findMany({
      where: {
        categoryId: {
          in: categoryIds,
        },
        isActive: true,
        isApproved: true,
      },
      include: {
        category: true,
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listMine(user: any) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER kendi ürünlerini görebilir');
    }

    return this.prisma.product.findMany({
      where: {
        sellerId: user.companyId,
      },
      include: {
        category: true,
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            status: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPending(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN bekleyen ürünleri görebilir');
    }

    return this.prisma.product.findMany({
      where: {
        isApproved: false,
      },
      include: {
        category: true,
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            verified: true,
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        isActive: true,
        isApproved: true,
      },
      include: {
        category: true,
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            status: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    return product;
  }

  async create(user: any, body: CreateProductDto) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER ürün ekleyebilir');
    }

    return this.prisma.product.create({
      data: {
        sellerId: user.companyId,
        categoryId: body.categoryId || null,
        title: body.title,
        description: body.description || null,
        imageUrl: body.imageUrl || null,
        unitType: body.unitType,
        moq: body.moq,
        basePrice: body.basePrice,
        leadTimeDays: body.leadTimeDays || null,
        stockType: body.stockType || null,
        vatRate: body.vatRate || null,
        rfqEnabled: body.rfqEnabled ?? true,
        isActive: true,
        isApproved: true,
      },
      include: {
        category: true,
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            status: true,
          },
        },
      },
    });
  }

  async addImages(user: any, id: string, body: any) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER ürün görseli ekleyebilir');
    }

    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    if (product.sellerId !== user.companyId) {
      throw new ForbiddenException('Bu ürün size ait değil');
    }

    const images = Array.isArray(body?.images) ? body.images : [];

    if (images.length === 0) {
      throw new BadRequestException('Eklenecek görsel bulunamadı');
    }

    await this.prisma.productImage.createMany({
      data: images.map((img: any, index: number) => ({
        productId: id,
        url: img.url,
        sortOrder: img.sortOrder ?? index,
        isCover: img.isCover ?? index === 0,
      })),
    });

    const coverImage =
      images.find((img: any) => img.isCover)?.url || images[0]?.url || null;

    if (coverImage) {
      await this.prisma.product.update({
        where: { id },
        data: {
          imageUrl: coverImage,
        },
      });
    }

    return this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            status: true,
          },
        },
      },
    });
  }

  async update(user: any, id: string, body: UpdateProductDto) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Sadece SELLER ürün güncelleyebilir');
    }

    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    if (product.sellerId !== user.companyId) {
      throw new ForbiddenException('Bu ürün size ait değil');
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(body.categoryId !== undefined
          ? { categoryId: body.categoryId || null }
          : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined
          ? { description: body.description || null }
          : {}),
        ...(body.imageUrl !== undefined
          ? { imageUrl: body.imageUrl || null }
          : {}),
        ...(body.unitType !== undefined ? { unitType: body.unitType } : {}),
        ...(body.moq !== undefined ? { moq: body.moq } : {}),
        ...(body.basePrice !== undefined ? { basePrice: body.basePrice } : {}),
        ...(body.leadTimeDays !== undefined
          ? { leadTimeDays: body.leadTimeDays || null }
          : {}),
        ...(body.stockType !== undefined
          ? { stockType: body.stockType || null }
          : {}),
        ...(body.vatRate !== undefined
          ? { vatRate: body.vatRate || null }
          : {}),
        ...(body.rfqEnabled !== undefined
          ? { rfqEnabled: body.rfqEnabled }
          : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: {
        category: true,
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            status: true,
          },
        },
      },
    });
  }

  async approve(user: any, id: string) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN ürün onaylayabilir');
    }

    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        isApproved: true,
      },
      include: {
        category: true,
        images: {
          orderBy: { sortOrder: 'asc' },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            status: true,
          },
        },
      },
    });
  }
}