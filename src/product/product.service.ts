import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CompanyStatus, Prisma, ProductAttributeType, Role } from '@prisma/client';
import {
  CreateProductDto,
  ProductAttributeValueDto,
  ProductVariantDto,
} from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  normalizeProductLanguage,
  SUPPORTED_PRODUCT_LANGUAGES,
} from './product-language';
import { AiService } from '../ai/ai.service';
import { ProductCatalogService } from './product-catalog.service';

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly catalogService: ProductCatalogService,
  ) {}

  private async requireVerifiedSellerCompany(user: any) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Bu işlem yalnızca satıcı firmalar içindir');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        id: true,
        status: true,
        verified: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Satıcı firması bulunamadı');
    }

    if (company.status !== CompanyStatus.APPROVED) {
      throw new ForbiddenException(
        'Firmanız onaylanmadan ürün işlemi yapamazsınız',
      );
    }

    if (!company.verified) {
      throw new ForbiddenException(
        'Firma doğrulaması tamamlanmadan ürün işlemi yapamazsınız',
      );
    }

    return company;
  }

  private applyTranslation(product: any) {
    const productTranslation = product.translations?.[0];
    const categoryTranslation = product.category?.translations?.[0];

    const {
      translations: _productTranslations,
      category,
      ...rest
    } = product;

    return {
      ...rest,
      title: productTranslation?.title || product.title,
      description:
        productTranslation?.description ?? product.description,
      category: category
        ? {
            ...category,
            name: categoryTranslation?.name || category.name,
            translations: undefined,
          }
        : category,
    };
  }

  async list(query: {
  categoryId?: string;
  sellerId?: string;
  q?: string;
  minPrice?: string;
  maxPrice?: string;
  minMoq?: string;
  maxMoq?: string;
  city?: string;
  verified?: string;
  lang?: string;
}) {
  const {
    categoryId,
    sellerId,
    q,
    minPrice,
    maxPrice,
    minMoq,
    maxMoq,
    city,
    verified,
    lang,
  } = query;

    const language = normalizeProductLanguage(lang);

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

    const products = await this.prisma.product.findMany({
      where: {
        isActive: true,
        isApproved: true,
        ...categoryFilter,
        ...(q
          ? {
              OR: [
                {
                  title: {
                    contains: q,
                    mode: 'insensitive',
                  },
                },
                {
                  translations: {
                    some: {
                      language,
                      OR: [
                        {
                          title: {
                            contains: q,
                            mode: 'insensitive',
                          },
                        },
                        {
                          description: {
                            contains: q,
                            mode: 'insensitive',
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
        ...(sellerId ? { sellerId } : {}),
        ...(minPrice || maxPrice
  ? {
      basePrice: {
        ...(minPrice ? { gte: Number(minPrice) } : {}),
        ...(maxPrice ? { lte: Number(maxPrice) } : {}),
      },
    }
  : {}),
...(minMoq || maxMoq
  ? {
      moq: {
        ...(minMoq ? { gte: Number(minMoq) } : {}),
        ...(maxMoq ? { lte: Number(maxMoq) } : {}),
      },
    }
  : {}),
...(city || verified
  ? {
      seller: {
        ...(city ? { city: { contains: city } } : {}),
        ...(verified === "true" ? { verified: true } : {}),
      },
    }
  : {}),
      },
      select: {
        id: true,
        categoryId: true,
        title: true,
        description: true,
        imageUrl: true,
        country: true,
        city: true,
        sku: true,
        brandId: true,
        barcode: true,
        manufacturerCode: true,
        unitType: true,
        moq: true,
        quantityStep: true,
        basePrice: true,
        leadTimeDays: true,
        stockType: true,
        stockQuantity: true,
        vatRate: true,
        rfqEnabled: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
        translations: {
          where: { language },
          take: 1,
        },
        category: {
          include: {
            translations: {
              where: { language },
              take: 1,
            },
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((product) => this.applyTranslation(product));
  }

  async listByCategory(categoryId: string, lang?: string) {
    const language = normalizeProductLanguage(lang);

    const childCategories = await this.prisma.category.findMany({
      where: {
        parentId: categoryId,
      },
      select: {
        id: true,
      },
    });

    const categoryIds = [categoryId, ...childCategories.map((c) => c.id)];

    const products = await this.prisma.product.findMany({
      where: {
        categoryId: {
          in: categoryIds,
        },
        isActive: true,
        isApproved: true,
      },
      select: {
        id: true,
        categoryId: true,
        title: true,
        description: true,
        imageUrl: true,
        country: true,
        city: true,
        sku: true,
        brandId: true,
        barcode: true,
        manufacturerCode: true,
        unitType: true,
        moq: true,
        quantityStep: true,
        basePrice: true,
        leadTimeDays: true,
        stockType: true,
        stockQuantity: true,
        vatRate: true,
        rfqEnabled: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
        translations: {
          where: { language },
          take: 1,
        },
        category: {
          include: {
            translations: {
              where: { language },
              take: 1,
            },
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return products.map((product) => this.applyTranslation(product));
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
        brand: true,
        variants: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        attributeValues: {
          include: {
            attribute: {
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                },
              },
            },
          },
        },
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
        brand: true,
        variants: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        attributeValues: {
          include: {
            attribute: {
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                },
              },
            },
          },
        },
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

  async getOne(id: string, lang?: string) {
    const language = normalizeProductLanguage(lang);

    const product = await this.prisma.product.findFirst({
      where: {
        id,
        isActive: true,
        isApproved: true,
      },
      select: {
        id: true,
        categoryId: true,
        title: true,
        description: true,
        imageUrl: true,
        country: true,
        city: true,
        sku: true,
        brandId: true,
        barcode: true,
        manufacturerCode: true,
        unitType: true,
        moq: true,
        quantityStep: true,
        basePrice: true,
        leadTimeDays: true,
        stockType: true,
        stockQuantity: true,
        vatRate: true,
        rfqEnabled: true,
        isActive: true,
        isApproved: true,
        createdAt: true,
        updatedAt: true,
        translations: {
          where: { language },
          take: 1,
        },
        category: {
          include: {
            translations: {
              where: { language },
              take: 1,
            },
          },
        },
        brand: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        variants: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        attributeValues: {
          include: {
            attribute: {
              include: {
                translations: {
                  where: { language },
                  take: 1,
                },
                options: {
                  where: { isActive: true },
                  include: {
                    translations: {
                      where: { language },
                      take: 1,
                    },
                  },
                  orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                },
              },
            },
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    return this.applyTranslation(product);
  }

  async reportProduct(
    user: any,
    productId: string,
    body: { reason: string; note?: string },
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        sellerId: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    if (product.sellerId === user.companyId) {
      throw new ForbiddenException('Kendi ürününüzü bildiremezsiniz');
    }

    const reason = body?.reason?.trim();

    if (!reason) {
      throw new BadRequestException('Bildirim nedeni zorunludur');
    }

    return this.prisma.productReport.create({
      data: {
        productId,
        reporterId: user.id,
        reason,
        note: body?.note?.trim() || null,
      },
      select: {
        id: true,
        reason: true,
        note: true,
        status: true,
        createdAt: true,
      },
    });
  }

  private async generateProductTranslations(product: {
    id: string;
    title: string;
    description: string | null;
    sourceLanguage: string;
  }) {
    const sourceLanguage = normalizeProductLanguage(product.sourceLanguage);

    const targetLanguages = SUPPORTED_PRODUCT_LANGUAGES.filter(
      (language) => language !== sourceLanguage,
    );

    await Promise.allSettled(
      targetLanguages.map(async (targetLanguage) => {
        const translated = await this.aiService.translateProductContent({
          sourceLanguage,
          targetLanguage,
          title: product.title,
          description: product.description,
        });

        if (!translated.title) {
          return;
        }

        await this.prisma.productTranslation.upsert({
          where: {
            productId_language: {
              productId: product.id,
              language: targetLanguage,
            },
          },
          update: {
            title: translated.title,
            description: translated.description,
          },
          create: {
            productId: product.id,
            language: targetLanguage,
            title: translated.title,
            description: translated.description,
          },
        });
      }),
    );
  }

  async create(user: any, body: CreateProductDto) {
    await this.requireVerifiedSellerCompany(user);

    const product = await this.prisma.$transaction(async (tx) => {
      const brandId = await this.catalogService.validateBrand(tx, body.brandId);
      const attributeValues = await this.catalogService.validateAttributeValues(
        tx,
        body.categoryId || null,
        body.attributeValues ?? [],
        true,
      );
      const variants = this.catalogService.normalizeVariants(body.variants ?? []);

      return tx.product.create({
        data: {
          sellerId: user.companyId,
          categoryId: body.categoryId || null,
          title: body.title,
          description: body.description || null,
          sourceLanguage: normalizeProductLanguage(body.sourceLanguage),
          imageUrl: body.imageUrl || null,
          country: body.country || null,
          city: body.city || null,
          sku: body.sku?.trim().toUpperCase() || null,
          brandId,
          barcode: body.barcode?.trim() || null,
          manufacturerCode: body.manufacturerCode?.trim() || null,
          unitType: body.unitType,
          moq: body.moq,
          quantityStep: body.quantityStep ?? 1,
          basePrice: body.basePrice,
          leadTimeDays: body.leadTimeDays || null,
          stockType: body.stockType || null,
          stockQuantity:
            body.stockQuantity !== undefined && body.stockQuantity !== null
              ? Number(body.stockQuantity)
              : null,
          vatRate: body.vatRate ?? null,
          rfqEnabled: body.rfqEnabled ?? true,
          isActive: true,
          isApproved: true,
          variants: {
            create: variants,
          },
          attributeValues: {
            create: attributeValues,
          },
        },
        include: {
          category: true,
          brand: true,
          variants: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          attributeValues: {
            include: {
              attribute: {
                include: {
                  options: {
                    where: { isActive: true },
                    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                  },
                },
              },
            },
          },
          images: {
            orderBy: { sortOrder: 'asc' },
          },
          seller: {
            select: {
              id: true,
              name: true,
              verified: true,
              status: true,
              rating: true,
              reviewCount: true,
              city: true,
              responseTime: true,
            },
          },
        },
      });
    });

    await this.generateProductTranslations({
      id: product.id,
      title: product.title,
      description: product.description,
      sourceLanguage: product.sourceLanguage,
    });

    return product;
  }

  async addImages(user: any, id: string, body: any) {
    await this.requireVerifiedSellerCompany(user);

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
            rating: true,
            reviewCount: true,
            city: true,
            responseTime: true,
          },
        },
      },
    });
  }

  async replaceImages(user: any, id: string, body: any) {
    await this.requireVerifiedSellerCompany(user);

    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    if (product.sellerId !== user.companyId) {
      throw new ForbiddenException('Bu ürün size ait değil');
    }

    const rawImages = Array.isArray(body?.images) ? body.images : [];

    const images = rawImages
      .filter(
        (img: any) =>
          img &&
          typeof img.url === 'string' &&
          img.url.trim().length > 0,
      )
      .map((img: any, index: number) => ({
        url: img.url.trim(),
        sortOrder: index,
        isCover: Boolean(img.isCover),
      }));

    if (images.length > 0) {
      const requestedCoverIndex = images.findIndex((img) => img.isCover);
      const coverIndex = requestedCoverIndex >= 0 ? requestedCoverIndex : 0;

      images.forEach((img, index) => {
        img.isCover = index === coverIndex;
      });
    }

    const coverImage =
      images.find((img) => img.isCover)?.url || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({
        where: { productId: id },
      });

      if (images.length > 0) {
        await tx.productImage.createMany({
          data: images.map((img) => ({
            productId: id,
            url: img.url,
            sortOrder: img.sortOrder,
            isCover: img.isCover,
          })),
        });
      }

      await tx.product.update({
        where: { id },
        data: {
          imageUrl: coverImage,
        },
      });
    });

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
            rating: true,
            reviewCount: true,
            city: true,
            responseTime: true,
          },
        },
      },
    });
  }

  async update(user: any, id: string, body: UpdateProductDto) {
    await this.requireVerifiedSellerCompany(user);

    const product = await this.prisma.product.findUnique({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Ürün bulunamadı');
    }

    if (product.sellerId !== user.companyId) {
      throw new ForbiddenException('Bu ürün size ait değil');
    }

    const contentChanged =
      body.title !== undefined || body.description !== undefined;

    const updatedProduct = await this.prisma.$transaction(async (tx) => {
      const effectiveCategoryId =
        body.categoryId !== undefined
          ? body.categoryId || null
          : product.categoryId;

      const categoryChanged =
        body.categoryId !== undefined &&
        effectiveCategoryId !== product.categoryId;

      let brandId: string | null | undefined;
      if (body.brandId !== undefined) {
        brandId = await this.catalogService.validateBrand(tx, body.brandId || null);
      }

      let attributeValues:
        | Awaited<ReturnType<ProductCatalogService['validateAttributeValues']>>
        | undefined;

      if (body.attributeValues !== undefined || categoryChanged) {
        attributeValues = await this.catalogService.validateAttributeValues(
          tx,
          effectiveCategoryId,
          body.attributeValues ?? [],
          true,
        );
      }

      const variants =
        body.variants !== undefined
          ? this.catalogService.normalizeVariants(body.variants)
          : undefined;

      await tx.product.update({
        where: { id },
        data: {
          ...(body.categoryId !== undefined
            ? { categoryId: effectiveCategoryId }
            : {}),
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.description !== undefined
            ? { description: body.description || null }
            : {}),
          ...(body.imageUrl !== undefined
            ? { imageUrl: body.imageUrl || null }
            : {}),
          ...(body.sku !== undefined
            ? { sku: body.sku?.trim().toUpperCase() || null }
            : {}),
          ...(body.brandId !== undefined ? { brandId: brandId ?? null } : {}),
          ...(body.barcode !== undefined
            ? { barcode: body.barcode?.trim() || null }
            : {}),
          ...(body.manufacturerCode !== undefined
            ? { manufacturerCode: body.manufacturerCode?.trim() || null }
            : {}),
          ...(body.unitType !== undefined ? { unitType: body.unitType } : {}),
          ...(body.moq !== undefined ? { moq: body.moq } : {}),
          ...(body.quantityStep !== undefined
            ? { quantityStep: body.quantityStep }
            : {}),
          ...(body.basePrice !== undefined ? { basePrice: body.basePrice } : {}),
          ...(body.leadTimeDays !== undefined
            ? { leadTimeDays: body.leadTimeDays || null }
            : {}),
          ...(body.stockType !== undefined
            ? { stockType: body.stockType || null }
            : {}),
          ...(body.stockQuantity !== undefined
            ? {
                stockQuantity:
                  body.stockQuantity === null
                    ? null
                    : Number(body.stockQuantity),
              }
            : {}),
          ...(body.vatRate !== undefined
            ? { vatRate: body.vatRate ?? null }
            : {}),
          ...(body.rfqEnabled !== undefined
            ? { rfqEnabled: body.rfqEnabled }
            : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });

      if (attributeValues !== undefined) {
        await tx.productAttributeValue.deleteMany({
          where: { productId: id },
        });

        if (attributeValues.length > 0) {
          await tx.productAttributeValue.createMany({
            data: attributeValues.map((value) => ({
              productId: id,
              ...value,
            })),
          });
        }
      }

      if (variants !== undefined) {
        await tx.productVariant.deleteMany({
          where: { productId: id },
        });

        if (variants.length > 0) {
          await tx.productVariant.createMany({
            data: variants.map((variant) => ({
              productId: id,
              ...variant,
            })),
          });
        }
      }

      return tx.product.findUniqueOrThrow({
        where: { id },
        include: {
          category: true,
          brand: true,
          variants: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          attributeValues: {
            include: {
              attribute: {
                include: {
                  options: {
                    where: { isActive: true },
                    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                  },
                },
              },
            },
          },
          images: {
            orderBy: { sortOrder: 'asc' },
          },
          seller: {
            select: {
              id: true,
              name: true,
              verified: true,
              status: true,
              rating: true,
              reviewCount: true,
              city: true,
              responseTime: true,
            },
          },
        },
      });
    });

    if (contentChanged) {
      await this.generateProductTranslations({
        id: updatedProduct.id,
        title: updatedProduct.title,
        description: updatedProduct.description,
        sourceLanguage: updatedProduct.sourceLanguage,
      });
    }

    return updatedProduct;
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
            rating: true,
            reviewCount: true,
            city: true,
            responseTime: true,
          },
        },
      },
    });
  }
}
