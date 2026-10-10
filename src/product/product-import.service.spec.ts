import { BadRequestException } from '@nestjs/common';
import {
  CompanyStatus,
  ProductImportRowAction,
  ProductImportSource,
  ProductImportStatus,
  Role,
} from '@prisma/client';
import { ProductImportService } from './product-import.service';

describe('ProductImportService XML import', () => {
  const sellerId = 'seller-1';

  const prisma = {
    company: {
      findUnique: jest.fn(),
    },
    category: {
      findMany: jest.fn(),
    },
    brand: {
      findMany: jest.fn(),
    },
    product: {
      findMany: jest.fn(),
    },
    productImportJob: {
      create: jest.fn(),
      update: jest.fn(),
    },
    productImportRow: {
      createMany: jest.fn(),
    },
  };

  let service: ProductImportService;

  const user = {
    companyId: sellerId,
    role: Role.SELLER,
  };

  const file = (xml: string, originalname = 'urunler.xml') => ({
    originalname,
    buffer: Buffer.from(xml, 'utf8'),
  });

  beforeEach(() => {
    jest.clearAllMocks();

    prisma.company.findUnique.mockResolvedValue({
      id: sellerId,
      status: CompanyStatus.APPROVED,
      verified: true,
    });
    prisma.category.findMany.mockResolvedValue([]);
    prisma.brand.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([]);
    prisma.productImportJob.create.mockResolvedValue({
      id: 'job-1',
      source: ProductImportSource.XML,
      status: ProductImportStatus.READY,
      originalFileName: 'urunler.xml',
      totalRows: 1,
      readyRows: 1,
      errorRows: 0,
      newRows: 1,
      updateRows: 0,
      unchangedRows: 0,
      processedRows: 0,
      createdAt: new Date('2026-10-06T00:00:00.000Z'),
    });
    prisma.productImportRow.createMany.mockResolvedValue({ count: 1 });
    prisma.productImportJob.update.mockResolvedValue({});

    service = new ProductImportService(
      prisma as never,
      {} as never,
      {} as never,
    );
  });

  it('canonical XML verisini ortak import job sistemine aktarır', async () => {
    const xml = `
      <products>
        <product>
          <sku>abc-001</sku>
          <title>Test Ürün</title>
          <description>Test açıklama</description>
          <unitType>Adet</unitType>
          <basePrice>90,50</basePrice>
          <vatRate>20</vatRate>
          <moq>6</moq>
          <quantityStep>6</quantityStep>
          <stockQuantity>120</stockQuantity>
          <stockType>STOCKED</stockType>
          <leadTimeDays>2</leadTimeDays>
          <imageUrls>https://example.com/a.jpg|https://example.com/b.jpg</imageUrls>
          <country>Türkiye</country>
          <city>İstanbul</city>
          <sourceLanguage>tr</sourceLanguage>
        </product>
      </products>
    `;

    const result = await service.createXmlJob(user, file(xml));

    expect(result.id).toBe('job-1');
    expect(prisma.productImportJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sellerId,
          source: ProductImportSource.XML,
          status: ProductImportStatus.READY,
          totalRows: 1,
          newRows: 1,
          errorRows: 0,
        }),
      }),
    );

    expect(prisma.productImportRow.createMany).toHaveBeenCalledTimes(1);

    const call = prisma.productImportRow.createMany.mock.calls[0][0];
    expect(call.data).toHaveLength(1);
    expect(call.data[0]).toEqual(
      expect.objectContaining({
        jobId: 'job-1',
        rowNumber: 1,
        sku: 'ABC-001',
        action: ProductImportRowAction.NEW,
      }),
    );
    expect(call.data[0].normalized).toEqual(
      expect.objectContaining({
        sku: 'ABC-001',
        title: 'Test Ürün',
        unitType: 'Adet',
        basePrice: 90.5,
        vatRate: 20,
        moq: 6,
        quantityStep: 6,
        stockQuantity: 120,
        leadTimeDays: 2,
        country: 'Türkiye',
        city: 'İstanbul',
        sourceLanguage: 'tr',
        imageUrls: [
          'https://example.com/a.jpg',
          'https://example.com/b.jpg',
        ],
      }),
    );
  });

  it('geçersiz veya HTTP görsel URL adresini sessizce yok saymaz', async () => {
    const xml = `
      <products>
        <product>
          <sku>IMG-001</sku>
          <title>Görsel Test Ürün</title>
          <unitType>Adet</unitType>
          <basePrice>10</basePrice>
          <moq>1</moq>
          <quantityStep>1</quantityStep>
          <imageUrls>http://example.com/a.jpg</imageUrls>
        </product>
      </products>
    `;

    await service.createXmlJob(user, file(xml));

    const call = prisma.productImportRow.createMany.mock.calls[0][0];
    expect(call.data[0]).toEqual(
      expect.objectContaining({
        sku: 'IMG-001',
        action: ProductImportRowAction.ERROR,
      }),
    );
    expect(call.data[0].errors).toEqual(
      expect.arrayContaining([
        'Görsel URL alanında yalnızca geçerli HTTPS adresleri kullanılabilir',
      ]),
    );
    expect(call.data[0].normalized).toEqual(
      expect.objectContaining({
        imageUrlsProvided: true,
        imageUrls: [],
      }),
    );
  });

  it('DOCTYPE kullanımını reddeder', async () => {
    const xml = `<!DOCTYPE products><products><product><sku>A1</sku></product></products>`;

    await expect(service.createXmlJob(user, file(xml))).rejects.toThrow(
      'XML dosyasında DOCTYPE veya ENTITY kullanımına izin verilmez',
    );

    expect(prisma.productImportJob.create).not.toHaveBeenCalled();
  });

  it('ENTITY kullanımını reddeder', async () => {
    const xml = `<!ENTITY test "x"><products><product><sku>A1</sku></product></products>`;

    await expect(service.createXmlJob(user, file(xml))).rejects.toThrow(
      'XML dosyasında DOCTYPE veya ENTITY kullanımına izin verilmez',
    );

    expect(prisma.productImportJob.create).not.toHaveBeenCalled();
  });

  it('bozuk XML dosyasını reddeder', async () => {
    const xml = `<products><product><sku>A1</sku></products>`;

    await expect(service.createXmlJob(user, file(xml))).rejects.toThrow(
      BadRequestException,
    );

    expect(prisma.productImportJob.create).not.toHaveBeenCalled();
  });

  it('products dışındaki kök düğümü reddeder', async () => {
    const xml = `<catalog><product><sku>A1</sku></product></catalog>`;

    await expect(service.createXmlJob(user, file(xml))).rejects.toThrow(
      'XML kök düğümü products olmalıdır',
    );

    expect(prisma.productImportJob.create).not.toHaveBeenCalled();
  });

  it('products altında product dışındaki düğümleri reddeder', async () => {
    const xml = `
      <products>
        <metadata>yasak</metadata>
        <product>
          <sku>A1</sku>
          <title>Ürün</title>
          <unitType>Adet</unitType>
          <basePrice>10</basePrice>
          <moq>1</moq>
          <quantityStep>1</quantityStep>
        </product>
      </products>
    `;

    await expect(service.createXmlJob(user, file(xml))).rejects.toThrow(
      'XML products altında yalnızca product düğümleri olabilir: metadata',
    );

    expect(prisma.productImportJob.create).not.toHaveBeenCalled();
  });

  it('eşlenen alanlarda iç içe XML yapısını reddeder', async () => {
    const xml = `
      <products>
        <product>
          <sku>A1</sku>
          <title><text>Ürün</text></title>
          <unitType>Adet</unitType>
          <basePrice>10</basePrice>
          <moq>1</moq>
          <quantityStep>1</quantityStep>
        </product>
      </products>
    `;

    await expect(service.createXmlJob(user, file(xml))).rejects.toThrow(
      'XML alanı iç içe olamaz: title (ürün 1)',
    );

    expect(prisma.productImportJob.create).not.toHaveBeenCalled();
  });
});
