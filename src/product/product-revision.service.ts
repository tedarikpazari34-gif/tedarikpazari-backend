import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductCatalogService } from './product-catalog.service';
import { Prisma, Role } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from './dto/update-product.dto';


@Injectable()
export class ProductRevisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: ProductCatalogService,
  ) {}

  private requireAdmin(user: { role?: Role }) {
    if (user?.role !== Role.ADMIN) {
      throw new ForbiddenException(
        'Ürün revizyonlarını yalnızca yönetici inceleyebilir',
      );
    }
  }

  async approveRevision(
    user: { id: string; role?: Role },
    revisionId: string,
  ) {
    this.requireAdmin(user);

    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.productRevision.findUnique({
        where: { id: revisionId },
        select: { productId: true },
      });

      if (!initial) {
        throw new NotFoundException('Ürün revizyonu bulunamadı');
      }

      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('product-revision'),
          hashtext(${initial.productId})
        )
      `;

      const revision = await tx.productRevision.findUniqueOrThrow({
        where: { id: revisionId },
      });

      if (revision.status !== 'PENDING') {
        throw new BadRequestException(
          'Bu revizyon daha önce sonuçlandırılmış',
        );
      }

      // Revizyonun ürün ve satıcı doğrulaması
      const product = await tx.product.findUnique({
        where: { id: revision.productId },
        select: {
          id: true,
          sellerId: true,
          isApproved: true,
        },
      });

      if (!product) {
        throw new NotFoundException('Revizyona ait ürün bulunamadı');
      }

      if (
        product.sellerId !== revision.sellerId ||
        !product.isApproved
      ) {
        throw new BadRequestException(
          'Revizyonun ürün veya satıcı bilgileri geçersiz',
        );
      }

      const data = revision.proposedData;

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new BadRequestException('Revizyon verileri geçersiz');
      }

      const fields = data as Record<string, unknown>;
      const allowed = new Set([
        'title', 'description', 'categoryId', 'brandId',
        'imageUrl', 'images', 'sku', 'barcode', 'manufacturerCode',
        'unitType', 'moq', 'quantityStep', 'vatRate',
        'leadTimeDays', 'stockType', 'sourceLanguage',
        'country', 'city', 'attributeValues',
      ]);

      if (Object.keys(fields).some((key) => !allowed.has(key))) {
        throw new BadRequestException(
          'Revizyonda onaylanamayan alanlar bulunuyor',
        );
      }

      // Onay öncesi revizyon doğrulaması
      if (Object.keys(fields).length === 0) {
        throw new BadRequestException('Boş revizyon onaylanamaz');
      }

      const dtoFields = Object.fromEntries(
        Object.entries(fields).filter(
          ([key]) => !['images', 'attributeValues'].includes(key),
        ),
      );

      const dto = plainToInstance(UpdateProductDto, dtoFields);
      const validationErrors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      });

      if (validationErrors.length > 0) {
        throw new BadRequestException(
          'Revizyon alanları onay doğrulamasından geçemedi',
        );
      }

      if (fields.brandId !== undefined) {
        await this.catalogService.validateBrand(
          tx,
          fields.brandId as string | null,
        );
      }

      if (fields.categoryId !== undefined && fields.categoryId !== null) {
        if (
          typeof fields.categoryId !== 'string' ||
          !fields.categoryId.trim()
        ) {
          throw new BadRequestException('Geçersiz kategori');
        }

        const category = await tx.category.findUnique({
          where: { id: fields.categoryId },
          select: { id: true },
        });

        if (!category) {
          throw new BadRequestException('Kategori artık mevcut değil');
        }
      }

      let validatedImages:
        | { url: string; isCover: boolean; sortOrder: number }[]
        | undefined;

      if (fields.images !== undefined) {
        if (
          !Array.isArray(fields.images) ||
          fields.images.length > 30 ||
          fields.images.some(
            (image) =>
              !image ||
              typeof image !== 'object' ||
              Array.isArray(image) ||
              typeof image.url !== 'string' ||
              !image.url.trim() ||
              image.url.length > 2048 ||
              !/^https:\/\//i.test(image.url.trim()) ||
              (image.isCover !== undefined &&
                typeof image.isCover !== 'boolean') ||
              Object.keys(image).some(
                (key) => !['url', 'isCover'].includes(key),
              ),
          )
        ) {
          throw new BadRequestException(
            'Onaylanacak ürün görselleri geçersiz',
          );
        }

        const coverIndex = fields.images.findIndex(
          (image) => image.isCover === true,
        );
        const selectedCoverIndex = coverIndex >= 0 ? coverIndex : 0;

        validatedImages = fields.images.map((image, index) => ({
          url: image.url.trim(),
          isCover: index === selectedCoverIndex,
          sortOrder: index,
        }));
      }

      if (
        validatedImages !== undefined &&
        fields.imageUrl !== undefined
      ) {
        const coverUrl =
          validatedImages.find((image) => image.isCover)?.url ?? null;

        if (fields.imageUrl !== coverUrl) {
          throw new BadRequestException(
            'Kapak görseli ile görsel listesi uyuşmuyor',
          );
        }
      }

      // Onayda zorunlu ürün alanlarının kontrolü
      for (const key of ['title', 'unitType', 'sourceLanguage']) {
        if (
          fields[key] !== undefined &&
          (typeof fields[key] !== 'string' ||
            !(fields[key] as string).trim())
        ) {
          throw new BadRequestException(
            `${key} boş veya geçersiz olamaz`,
          );
        }
      }

      for (const key of ['moq', 'quantityStep']) {
        if (
          fields[key] !== undefined &&
          (!Number.isInteger(fields[key]) ||
            (fields[key] as number) < 1)
        ) {
          throw new BadRequestException(
            `${key} pozitif tam sayı olmalıdır`,
          );
        }
      }

      for (const key of ['vatRate', 'leadTimeDays']) {
        if (
          fields[key] !== undefined &&
          fields[key] !== null &&
          (!Number.isInteger(fields[key]) ||
            (fields[key] as number) < 0)
        ) {
          throw new BadRequestException(
            `${key} negatif olmayan tam sayı olmalıdır`,
          );
        }
      }

      const currentCategoryId = (
        await tx.product.findUniqueOrThrow({
          where: { id: revision.productId },
          select: { categoryId: true },
        })
      ).categoryId;

      let validatedAttributes: Awaited<
        ReturnType<typeof this.catalogService.validateAttributeValues>
      > = [];

      if (
        fields.attributeValues !== undefined ||
        fields.categoryId !== undefined
      ) {
        if (!Array.isArray(fields.attributeValues)) {
          throw new BadRequestException(
            'Kategori değişikliklerinde özellik listesi zorunludur',
          );
        }

        validatedAttributes =
          await this.catalogService.validateAttributeValues(
            tx,
            fields.categoryId !== undefined ? fields.categoryId as string | null : currentCategoryId,
            fields.attributeValues,
            true,
          );
      }

      const productData = {
        ...(fields.title !== undefined
          ? { title: fields.title as string }
          : {}),
        ...(fields.description !== undefined
          ? { description: fields.description as string | null }
          : {}),
        ...(fields.categoryId !== undefined
          ? { categoryId: fields.categoryId as string | null }
          : {}),
        ...(fields.brandId !== undefined
          ? { brandId: fields.brandId as string | null }
          : {}),
        ...(fields.imageUrl !== undefined
          ? { imageUrl: fields.imageUrl as string | null }
          : {}),
        ...(fields.sku !== undefined
          ? { sku: fields.sku as string | null }
          : {}),
        ...(fields.barcode !== undefined
          ? { barcode: fields.barcode as string | null }
          : {}),
        ...(fields.manufacturerCode !== undefined
          ? { manufacturerCode: fields.manufacturerCode as string | null }
          : {}),
        ...(fields.unitType !== undefined
          ? { unitType: fields.unitType as string }
          : {}),
        ...(fields.moq !== undefined
          ? { moq: fields.moq as number }
          : {}),
        ...(fields.quantityStep !== undefined
          ? { quantityStep: fields.quantityStep as number }
          : {}),
        ...(fields.vatRate !== undefined
          ? { vatRate: fields.vatRate as number | null }
          : {}),
        ...(fields.leadTimeDays !== undefined
          ? { leadTimeDays: fields.leadTimeDays as number | null }
          : {}),
        ...(fields.stockType !== undefined
          ? { stockType: fields.stockType as string | null }
          : {}),
        ...(fields.sourceLanguage !== undefined
          ? { sourceLanguage: fields.sourceLanguage as string }
          : {}),
        ...(fields.country !== undefined
          ? { country: fields.country as string | null }
          : {}),
        ...(fields.city !== undefined
          ? { city: fields.city as string | null }
          : {}),
      };

      if (Object.keys(productData).length > 0) {
        await tx.product.update({
          where: { id: revision.productId },
          data: productData,
        });
      }

      if (
        fields.attributeValues !== undefined ||
        fields.categoryId !== undefined
      ) {
        await tx.productAttributeValue.deleteMany({
          where: { productId: revision.productId },
        });

        if (validatedAttributes.length > 0) {
          await tx.productAttributeValue.createMany({
            data: validatedAttributes.map((value) => ({
              productId: revision.productId,
              ...value,
            })),
          });
        }
      }

      if (validatedImages !== undefined) {
        await tx.productImage.deleteMany({
          where: { productId: revision.productId },
        });

        if (validatedImages.length > 0) {
          await tx.productImage.createMany({
            data: validatedImages.map((image) => ({
              productId: revision.productId,
              ...image,
            })),
          });
        }

        const coverImage = validatedImages.find(
          (image) => image.isCover,
        );

        await tx.product.update({
          where: { id: revision.productId },
          data: {
            imageUrl: coverImage?.url ?? null,
          },
        });
      }

      await tx.productRevision.update({
        where: { id: revisionId },
        data: {
          status: 'APPROVED',
          reviewedById: user.id,
          reviewedAt: new Date(),
          rejectionReason: null,
        },
      });

      return {
        revisionId,
        status: 'APPROVED',
      };
    });
  }

  async rejectRevision(
    user: { id: string; role?: Role },
    revisionId: string,
    reason: string,
  ) {
    this.requireAdmin(user);

    if (typeof reason !== 'string') {
      throw new BadRequestException('Geçerli bir ret gerekçesi girin');
    }

    const rejectionReason = reason.trim();
    if (!rejectionReason || rejectionReason.length > 1000) {
      throw new BadRequestException(
        'Ret gerekçesi 1 ile 1000 karakter arasında olmalıdır',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.productRevision.findUnique({
        where: { id: revisionId },
        select: { productId: true },
      });

      if (!initial) {
        throw new NotFoundException('Ürün revizyonu bulunamadı');
      }

      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('product-revision'),
          hashtext(${initial.productId})
        )
      `;

      const result = await tx.productRevision.updateMany({
        where: { id: revisionId, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          reviewedById: user.id,
          reviewedAt: new Date(),
          rejectionReason,
        },
      });

      if (result.count !== 1) {
        throw new BadRequestException(
          'Revizyon daha önce sonuçlandırılmış',
        );
      }

      return { revisionId, status: 'REJECTED', rejectionReason };
    });
  }

  async listPendingRevisions(user: { role?: Role }) {
    this.requireAdmin(user);

    return this.prisma.productRevision.findMany({
      where: { status: 'PENDING' },
      include: {
        product: {
          include: {
            category: true,
            brand: true,
            images: { orderBy: { sortOrder: 'asc' } },
            attributeValues: true,
            variants: { orderBy: { sortOrder: 'asc' } },
          },
        },
        seller: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  async savePendingRevision(
    sellerId: string,
    productId: string,
    proposedData: Record<string, unknown>,
    options: {
      appendImages?: boolean;
      rejectPendingConflicts?: boolean;
      tx?: Prisma.TransactionClient;
    } = {},
  ) {
    const allowedFields = new Set([
      'title', 'description', 'categoryId', 'brandId',
      'imageUrl', 'images', 'sku', 'barcode', 'manufacturerCode',
      'unitType', 'moq', 'quantityStep', 'vatRate',
      'leadTimeDays', 'stockType', 'sourceLanguage',
      'country', 'city', 'attributeValues', 'variants',
    ]);

    if (
      !proposedData ||
      typeof proposedData !== 'object' ||
      Array.isArray(proposedData) ||
      Object.keys(proposedData).length === 0 ||
      Object.keys(proposedData).some((key) => !allowedFields.has(key))
    ) {
      throw new BadRequestException('Geçersiz ürün revizyon alanları');
    }

    if (proposedData.images !== undefined) {
      const images = proposedData.images;

      if (
        !Array.isArray(images) ||
        images.length > 30 ||
        images.some(
          (image) =>
            !image ||
            typeof image !== 'object' ||
            Array.isArray(image) ||
            typeof image.url !== 'string' ||
            !image.url.trim() ||
            image.url.length > 2048 ||
            !/^https:\/\//i.test(image.url.trim()) ||
            (image.isCover !== undefined &&
              typeof image.isCover !== 'boolean') ||
            Object.keys(image).some(
              (key) => !['url', 'isCover'].includes(key),
            ),
        )
      ) {
        throw new BadRequestException('Geçersiz ürün görselleri');
      }
    }

    if (proposedData.variants !== undefined) {
      throw new BadRequestException(
        'Varyant değişiklikleri güvenli kimlik eşleştirmesi tamamlanana kadar onaya gönderilemez',
      );
    }

    const dtoFields = Object.fromEntries(
      Object.entries(proposedData).filter(([key]) => key !== 'images'),
    );

    const dto = plainToInstance(UpdateProductDto, dtoFields);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      validationError: { target: false, value: false },
    });

    if (errors.length > 0) {
      throw new BadRequestException(
        'Ürün revizyonundaki alanlar veya alt özellikler geçersiz',
      );
    }

    const positiveIntegers = ['moq', 'quantityStep'];
    const nonnegativeIntegers = ['vatRate', 'leadTimeDays'];

    for (const field of positiveIntegers) {
      if (
        proposedData[field] !== undefined &&
        (!Number.isInteger(proposedData[field]) ||
          (proposedData[field] as number) < 1)
      ) {
        throw new BadRequestException(`${field} pozitif tam sayı olmalıdır`);
      }
    }

    for (const field of nonnegativeIntegers) {
      const value = proposedData[field];
      if (
        value !== undefined &&
        value !== null &&
        (!Number.isInteger(value) || (value as number) < 0)
      ) {
        throw new BadRequestException(`${field} geçerli bir tam sayı olmalıdır`);
      }
    }

    if (
      proposedData.title !== undefined &&
      (typeof proposedData.title !== 'string' ||
        !proposedData.title.trim())
    ) {
      throw new BadRequestException('Ürün adı boş olamaz');
    }

    const execute = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtext('product-revision'),
          hashtext(${productId})
        )
      `;

      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, sellerId: true },
      });

      if (!product) {
        throw new NotFoundException('Ürün bulunamadı');
      }

      if (product.sellerId !== sellerId) {
        throw new ForbiddenException('Bu ürün size ait değil');
      }

      if (proposedData.categoryId !== undefined) {
        const categoryId = proposedData.categoryId;

        if (
          categoryId !== null &&
          (typeof categoryId !== 'string' || !categoryId.trim())
        ) {
          throw new BadRequestException('Geçersiz kategori bilgisi');
        }

        if (typeof categoryId === 'string') {
          const category = await tx.category.findUnique({
            where: { id: categoryId },
            select: { id: true },
          });

          if (!category) {
            throw new BadRequestException('Seçilen kategori bulunamadı');
          }
        }
      }

      if (proposedData.brandId !== undefined) {
        if (
          proposedData.brandId !== null &&
          typeof proposedData.brandId !== 'string'
        ) {
          throw new BadRequestException('Geçersiz marka bilgisi');
        }

        await this.catalogService.validateBrand(
          tx,
          proposedData.brandId as string | null,
        );
      }

      const pendingRevision = await tx.productRevision.findFirst({
        where: { productId, status: 'PENDING' },
        select: { id: true, proposedData: true },
      });

      const previous = pendingRevision?.proposedData;

      if (
        pendingRevision &&
        (!previous || typeof previous !== 'object' || Array.isArray(previous))
      ) {
        throw new BadRequestException(
          'Bekleyen ürün revizyonunun verileri geçersiz',
        );
      }

      const previousFields = pendingRevision
        ? previous as Record<string, unknown>
        : {};

      if (options.appendImages) {
        if (
          Object.keys(proposedData).length !== 1 ||
          !Array.isArray(proposedData.images)
        ) {
          throw new BadRequestException(
            'Görsel ekleme işleminde yalnızca images gönderilebilir',
          );
        }

        const previousImages = previousFields.images;

        if (
          previousImages !== undefined &&
          !Array.isArray(previousImages)
        ) {
          throw new BadRequestException(
            'Bekleyen görsel listesi geçersiz',
          );
        }

        const currentImages =
          previousImages !== undefined
            ? previousImages
            : await tx.productImage.findMany({
                where: { productId },
                orderBy: { sortOrder: 'asc' },
                select: { url: true, isCover: true },
              });

        if (!Array.isArray(currentImages)) {
          throw new BadRequestException(
            'Mevcut görsel listesi geçersiz',
          );
        }

        const mergedImages = [
          ...currentImages,
          ...proposedData.images,
        ];

        if (
          mergedImages.length > 30 ||
          mergedImages.some(
            (image) =>
              !image ||
              typeof image !== 'object' ||
              Array.isArray(image) ||
              typeof image.url !== 'string' ||
              !image.url.trim() ||
              image.url.length > 2048 ||
              !/^https:\/\//i.test(image.url.trim()) ||
              (image.isCover !== undefined &&
                typeof image.isCover !== 'boolean')
          )
        ) {
          throw new BadRequestException(
            'Birleştirilmiş ürün görselleri geçersiz veya 30 görsel sınırı aşıldı',
          );
        }

        const coverIndex = mergedImages.findIndex(
          (image) => image.isCover === true,
        );
        const selectedCoverIndex = coverIndex >= 0 ? coverIndex : 0;

        proposedData = {
          images: mergedImages.map((image, index) => ({
            url: image.url.trim(),
            isCover: index === selectedCoverIndex,
          })),
        };
      }

      if (options.rejectPendingConflicts && pendingRevision) {
        const conflictingFields = Object.keys(proposedData).filter(
          (field) =>
            Object.prototype.hasOwnProperty.call(previousFields, field) &&
            JSON.stringify(previousFields[field]) !==
              JSON.stringify(proposedData[field]),
        );

        if (conflictingFields.length > 0) {
          throw new BadRequestException(
            `Ürünün bekleyen revizyonuyla çakışan alanlar: ${conflictingFields.join(', ')}`,
          );
        }
      }

      const combined = { ...previousFields, ...proposedData };
      const categoryId =
        combined.categoryId !== undefined
          ? combined.categoryId
          : (await tx.product.findUniqueOrThrow({
              where: { id: productId },
              select: { categoryId: true },
            })).categoryId;

      if (
        categoryId !== null &&
        typeof categoryId !== 'string'
      ) {
        throw new BadRequestException('Geçersiz kategori bilgisi');
      }

      if (
        proposedData.categoryId !== undefined &&
        proposedData.attributeValues === undefined
      ) {
        throw new BadRequestException(
          'Kategori değiştirirken yeni kategori özelliklerini de gönderin',
        );
      }

      if (
        proposedData.attributeValues !== undefined ||
        proposedData.categoryId !== undefined
      ) {
        if (!Array.isArray(combined.attributeValues)) {
          throw new BadRequestException(
            'Kategori özellikleri liste olmalıdır',
          );
        }

        await this.catalogService.validateAttributeValues(
          tx,
          categoryId as string | null,
          combined.attributeValues,
          true,
        );
      }

      // Revizyon özellikleri doğrulandı

      const existing = pendingRevision;

      if (existing) {
        const previousData = existing.proposedData;

        if (
          !previousData ||
          typeof previousData !== 'object' ||
          Array.isArray(previousData)
        ) {
          throw new BadRequestException(
            'Bekleyen ürün revizyonunun verileri geçersiz',
          );
        }

        const mergedData = {
          ...previousData,
          ...proposedData,
        };

        return tx.productRevision.update({
          where: { id: existing.id },
          data: { proposedData: mergedData as any },
        });
      }

      return tx.productRevision.create({
        data: {
          productId,
          sellerId,
          status: 'PENDING',
          proposedData: proposedData as any,
        },
      });
    };

    return options.tx
      ? execute(options.tx)
      : this.prisma.$transaction(execute);
  }
}
