import * as ExcelJS from 'exceljs';
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
    variants: [],
  };

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'product-1' }]),
    product: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    productRevision: {
      findFirst: jest.fn(),
    },
    productImage: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
    },
    productVariant: {
      findFirst: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    tx.order.findFirst.mockResolvedValue(null);
    tx.productVariant.findFirst.mockResolvedValue(null);

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

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: productId,
        archivedAt: null,
        reservedQuantity: { lte: 100 },
      },
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

  it('onaylı üründe aynı SKU varyantının yalnızca fiyat ve stok bilgisini kimliği koruyarak günceller', async () => {
    tx.product.findUnique
      .mockResolvedValueOnce({
        id: productId,
        sku: normalized.sku,
        categoryId: null,
      })
      .mockResolvedValueOnce({ isApproved: true });

    tx.product.findUniqueOrThrow.mockResolvedValue({
      ...current,
      variants: [
        {
          id: 'variant-1',
          name: '80 Yaprak',
          sku: 'SKU-001-80',
          barcode: null,
          manufacturerCode: 'TEST-80',
          price: 95,
          stockQuantity: 25,
          isActive: true,
          sortOrder: 0,
        },
      ],
    });

    const incoming = {
      ...normalized,
      title: current.title,
      description: current.description,
      variantsProvided: true,
      variants: [
        {
          name: '80 Yaprak',
          sku: 'SKU-001-80',
          barcode: null,
          manufacturerCode: 'TEST-80',
          price: 99,
          stockQuantity: 40,
          isActive: true,
          sortOrder: 0,
        },
      ],
    };

    await process({
      ...row(ProductImportRowAction.UPDATE, productId),
      normalized: incoming,
    });

    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(tx.productVariant.createMany).not.toHaveBeenCalled();
    expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'variant-1',
        productId,
        reservedQuantity: { lte: 40 },
      },
      data: {
        price: 99,
        stockQuantity: 40,
      },
    });
  });

  it('onaylı üründe varyant yapısı değişirse Excel/XML güncellemesini reddeder', async () => {
    tx.product.findUnique
      .mockResolvedValueOnce({
        id: productId,
        sku: normalized.sku,
        categoryId: null,
      })
      .mockResolvedValueOnce({ isApproved: true });

    tx.product.findUniqueOrThrow.mockResolvedValue({
      ...current,
      variants: [
        {
          id: 'variant-1',
          name: '80 Yaprak',
          sku: 'SKU-001-80',
          barcode: null,
          manufacturerCode: 'TEST-80',
          price: 95,
          stockQuantity: 25,
          isActive: true,
          sortOrder: 0,
        },
      ],
    });

    const incoming = {
      ...normalized,
      title: current.title,
      description: current.description,
      variantsProvided: true,
      variants: [
        {
          name: '90 Yaprak',
          sku: 'SKU-001-80',
          barcode: null,
          manufacturerCode: 'TEST-80',
          price: 99,
          stockQuantity: 40,
          isActive: true,
          sortOrder: 0,
        },
      ],
    };

    await expect(
      process({
        ...row(ProductImportRowAction.UPDATE, productId),
        normalized: incoming,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.productVariant.update).not.toHaveBeenCalled();
    expect(tx.productImportRow.update).not.toHaveBeenCalled();
  });



  it('ürün rezervasyonundan düşük stok güncellemesini reddeder', async () => {
    tx.product.findUnique
      .mockResolvedValueOnce({
        id: productId,
        sku: normalized.sku,
        categoryId: null,
      })
      .mockResolvedValueOnce({ isApproved: true });

    tx.product.updateMany.mockResolvedValueOnce({ count: 0 });

    const incoming = {
      ...normalized,
      title: current.title,
      description: current.description,
      stockQuantity: 20,
    };

    await expect(process({
      ...row(ProductImportRowAction.UPDATE, productId),
      normalized: incoming,
    })).rejects.toThrow(
      'Excel/XML stok miktarı mevcut ürün rezervasyonlarından düşük olamaz',
    );

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: productId,
        archivedAt: null,
        reservedQuantity: { lte: 20 },
      },
      data: {
        basePrice: 90,
        stockQuantity: 20,
      },
    });

    expect(tx.productImportRow.update).not.toHaveBeenCalled();
  });

  it('varyant rezervasyonundan düşük stok güncellemesini reddeder', async () => {
    tx.product.findUnique
      .mockResolvedValueOnce({
        id: productId,
        sku: normalized.sku,
        categoryId: null,
      })
      .mockResolvedValueOnce({ isApproved: true });

    tx.product.findUniqueOrThrow.mockResolvedValue({
      ...current,
      variants: [{
        id: 'variant-1',
        name: '80 Yaprak',
        sku: 'SKU-001-80',
        barcode: null,
        manufacturerCode: 'TEST-80',
        price: 95,
        stockQuantity: 25,
        isActive: true,
        sortOrder: 0,
      }],
    });

    tx.productVariant.updateMany.mockResolvedValueOnce({ count: 0 });

    const incoming = {
      ...normalized,
      title: current.title,
      description: current.description,
      variantsProvided: true,
      variants: [{
        name: '80 Yaprak',
        sku: 'SKU-001-80',
        barcode: null,
        manufacturerCode: 'TEST-80',
        price: 99,
        stockQuantity: 10,
        isActive: true,
        sortOrder: 0,
      }],
    };

    await expect(process({
      ...row(ProductImportRowAction.UPDATE, productId),
      normalized: incoming,
    })).rejects.toThrow(
      'Excel/XML varyant stoğu mevcut rezervasyonlardan düşük olamaz',
    );

    expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'variant-1',
        productId,
        reservedQuantity: { lte: 10 },
      },
      data: {
        price: 99,
        stockQuantity: 10,
      },
    });

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

    expect(tx.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: productId,
        archivedAt: null,
        reservedQuantity: { lte: 250 },
      },
      data: {
        basePrice: 125,
        stockQuantity: 250,
      },
    });

    expect(tx.productImportRow.update).toHaveBeenCalledTimes(1);
  });

  it('onaysız mevcut ürünün varyantları sipariş geçmişi varsa silinemez', async () => {
    tx.order.findFirst.mockResolvedValue({ id: 'order-1' });

    await expect(
      process({
        ...row(ProductImportRowAction.UPDATE, productId),
        normalized: {
          ...normalized,
          variantsProvided: true,
          variants: [],
        },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(tx.productVariant.createMany).not.toHaveBeenCalled();
  });

  it('onaysız mevcut ürünün varyantları stok rezervasyonu varsa silinemez', async () => {
    tx.productVariant.findFirst.mockResolvedValue({ id: 'variant-1' });

    await expect(
      process({
        ...row(ProductImportRowAction.UPDATE, productId),
        normalized: {
          ...normalized,
          variantsProvided: true,
          variants: [],
        },
      }),
    ).rejects.toThrow(BadRequestException);

    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(tx.productVariant.createMany).not.toHaveBeenCalled();
  });


  it('boş SKU olan eski ürünü ID ile eşleştirir, yeni üründe SKU ister', async () => {
    const raw = {
      productId,
      sku: '',
      title: normalized.title,
      unitType: normalized.unitType,
      moq: '10',
      quantityStep: '1',
      basePrice: '90',
      stockQuantity: '100',
      vatRate: '20',
    };

    const parsed = (service as any).normalizeImportedRow(raw, new Map());
    expect(parsed.errors).toEqual([]);

    const findMany = jest.fn().mockResolvedValue([{
      ...current,
      id: productId,
      sku: null,
      brand: null,
      basePrice: 90,
      stockQuantity: 100,
    }]);

    (service as any).prisma = { product: { findMany } };

    const result = await (service as any).classifyRows(
      sellerId,
      [{
        rowNumber: 2,
        raw,
        normalized: parsed.normalized,
        errors: parsed.errors,
      }],
      new Map(),
    );

    expect(result[0].productId).toBe(productId);
    expect(result[0].action).toBe(ProductImportRowAction.UPDATE);

    const newRaw = { ...raw, productId: '' };
    const newParsed = (service as any).normalizeImportedRow(newRaw, new Map());

    const newResult = await (service as any).classifyRows(
      sellerId,
      [{
        rowNumber: 3,
        raw: newRaw,
        normalized: newParsed.normalized,
        errors: newParsed.errors,
      }],
      new Map(),
    );

    expect(newResult[0].action).toBe(ProductImportRowAction.ERROR);
    expect(newResult[0].errors).toContain('SKU zorunludur');
  });


  it('SKU boş eski ürünün güncellemesinde SKU alanını değiştirmez', async () => {
    tx.product.findFirst.mockResolvedValue({
      id: productId,
      sku: null,
      categoryId: null,
    });
    tx.product.findUnique.mockResolvedValue({ isApproved: false });
    tx.product.findUniqueOrThrow.mockResolvedValue({
      ...current,
      sku: null,
    });

    await process({
      ...row(ProductImportRowAction.UPDATE, productId),
      sku: null,
      normalized: {
        ...normalized,
        productId,
        sku: '',
      },
    });

    expect(tx.product.update).toHaveBeenCalled();
    for (const [args] of tx.product.update.mock.calls) {
      expect(args.data).not.toHaveProperty('sku');
    }
  });

  it('Excel dışa aktarma Ürün ID başlığını içe aktarırken tanır', () => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Ürünler');

      sheet.addRow(['Ürün ID (Değiştirmeyin)', 'SKU', 'Ürün Adı']);
      sheet.addRow([productId, '', 'Eski Ürün']);

      const headers = (service as any).getHeaderMap(sheet);
      expect(headers.get(1)).toBe('productId');

      const rows = (service as any).readExcelRows(sheet, headers);
      expect(rows).toHaveLength(1);
      expect(rows[0].raw.productId).toBe(productId);
    });

  it('Excel açıklamasındaki gereksiz boşluk güncelleme oluşturmamalı', () => {
      const incoming = {
        ...normalized,
        title: current.title,
        description: 'Çöp kovası Klik no:0 (1,5lt)',
      };

      const existing = {
        ...current,
        brand: null,
        basePrice: normalized.basePrice,
        stockQuantity: normalized.stockQuantity,
        description: 'Çöp kovası Klik no:0 (1,5lt) ',
      };

      expect(
        (service as any).productMatchesNormalized(existing, incoming),
      ).toBe(true);
    });

});
