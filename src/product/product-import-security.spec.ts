import { BadRequestException } from '@nestjs/common';
import { ProductImportRowAction } from '@prisma/client';
import { ProductImportService } from './product-import.service';

describe('ProductImportService moderation security', () => {
  const sellerId = 'seller-1';
  const productId = 'product-1';

  const normalized = {
    productId: null,
    sku: 'SKU-001',
    brand: null,
    barcode: null,
    manufacturerCode: null,
    title: 'Yeni ürün adı',
    description: 'Yeni açıklama',
    categoryId: null,
    categoryPath: null,
    sourceLanguage: 'tr',
    country: null,
    city: null,
    unitType: 'Adet',
    moq: 10,
    quantityStep: 1,
    basePrice: 90,
    leadTimeDays: null,
    stockType: null,
    stockQuantity: 100,
    vatRate: 20,
    imageUrlsProvided: false,
    imageUrls: [],
    variantsProvided: false,
    variants: [],
    attributeValuesProvided: false,
    attributeValues: [],
  };

  const current = {
    sku: normalized.sku,
    brandId: null,
    barcode: null,
    manufacturerCode: null,
    categoryId: null,
    title: 'Eski ürün adı',
    description: 'Eski açıklama',
    sourceLanguage: 'tr',
    country: null,
    city: null,
    unitType: 'Adet',
    moq: 10,
    quantityStep: 1,
    leadTimeDays: null,
    stockType: null,
    vatRate: 20,
    imageUrl: null,
    images: [],
    attributeValues: [],
  };

  const tx = {
    product: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    productRevision: {
      findFirst: jest.fn(),
    },
    productImage: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    productVariant: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    productAttributeValue: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    productImportRow: {
      update: jest.fn(),
    },
  };

  const catalog = {
    resolveBrandByName: jest.fn(),
  };

  const revision = {
    savePendingRevision: jest.fn(),
  };

  let service: ProductImportService;

  const row = (action: ProductImportRowAction, productIdValue: string | null) => ({
    id: 'row-1',
    sku: normalized.sku,
    action,
    productId: productIdValue,
    normalized: { ...normalized },
  });

  const process = (importRow: ReturnType<typeof row>) =>
    (service as any).processImportRow(tx, sellerId, importRow);

  beforeEach(() => {
    jest.clearAllMocks();

    tx.product.findFirst.mockResolvedValue({
      id: productId,
      sku: normalized.sku,
      categoryId: null,
    });
    tx.product.findUnique.mockResolvedValue(null);
    tx.product.findUniqueOrThrow.mockResolvedValue(current);
    tx.product.create.mockResolvedValue({ id: 'new-product-1' });
    tx.product.update.mockResolvedValue({ id: productId });
    tx.productRevision.findFirst.mockResolvedValue(null);

    catalog.resolveBrandByName.mockResolvedValue(null);
    revision.savePendingRevision.mockResolvedValue({ id: 'revision-1' });

    service = new ProductImportService(
      {} as never,
      catalog as never,
      revision as never,
    );
  });

  it('yeni ürünü yönetici onayı bekleyecek şekilde oluşturur', async () => {
    tx.product.findFirst.mockResolvedValue(null);

    await process(row(ProductImportRowAction.NEW, null));

    expect(tx.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isApproved: false,
          sellerId,
        }),
      }),
    );
  });

  it('onaylı ürünün içerik değişikliğini doğrudan yayınlamaz', async () => {
    tx.product.findUnique
      .mockResolvedValueOnce({
        id: productId,
        sku: normalized.sku,
        categoryId: null,
      })
      .mockResolvedValueOnce({ isApproved: true });

    await process(row(ProductImportRowAction.UPDATE, productId));

    expect(revision.savePendingRevision).toHaveBeenCalledWith(
      sellerId,
      productId,
      expect.objectContaining({
        title: 'Yeni ürün adı',
        description: 'Yeni açıklama',
      }),
      expect.objectContaining({
        rejectPendingConflicts: true,
      }),
    );

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: productId },
      data: {
        basePrice: 90,
        stockQuantity: 100,
      },
    });
  });

  it('revizyon çakışmasında doğrudan ürün güncellemez', async () => {
    tx.product.findUnique
      .mockResolvedValueOnce({
        id: productId,
        sku: normalized.sku,
        categoryId: null,
      })
      .mockResolvedValueOnce({ isApproved: true });

    revision.savePendingRevision.mockRejectedValue(
      new BadRequestException('Bekleyen revizyonla çakışma'),
    );

    await expect(
      process(row(ProductImportRowAction.UPDATE, productId)),
    ).rejects.toThrow(BadRequestException);

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.productImportRow.update).not.toHaveBeenCalled();
  });

  it('yalnızca fiyat ve stok değişikliğinde revizyon oluşturmaz', async () => {
    tx.product.findUnique
      .mockResolvedValueOnce({
        id: productId,
        sku: normalized.sku,
        categoryId: null,
      })
      .mockResolvedValueOnce({ isApproved: true });

    const incoming = {
      ...normalized,
      title: current.title,
      description: current.description,
      basePrice: 125,
      stockQuantity: 250,
    };

    await process({
      ...row(ProductImportRowAction.UPDATE, productId),
      normalized: incoming,
    });

    expect(revision.savePendingRevision).not.toHaveBeenCalled();

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: productId },
      data: {
        basePrice: 125,
        stockQuantity: 250,
      },
    });

    expect(tx.productImportRow.update).toHaveBeenCalledTimes(1);
  });

});
