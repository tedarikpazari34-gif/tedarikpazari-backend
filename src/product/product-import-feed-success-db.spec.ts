import {
  PrismaClient,
  ProductImportRowAction,
  ProductImportSource,
  ProductImportStatus,
  Role,
} from '@prisma/client';
import { ProductImportService } from './product-import.service';

const testUrl =
  'postgresql://nazcetin@127.0.0.1:55432/tedarik_xml_atomic_test_20261022?schema=public';

const run = process.env.RUN_XML_ATOMIC_DB_TEST === '1'
  ? describe
  : describe.skip;

run('Gerçek PostgreSQL XML rollback testi', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: testUrl } },
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('başarılı XML senkronizasyonu ürünleri ve feed durumunu kaydeder', async () => {
    const connection = await prisma.$queryRaw<
      Array<{ db: string; port: number }>
    >`SELECT current_database() AS db, inet_server_port() AS port`;

    expect(connection[0].db).toBe('tedarik_xml_atomic_test_20261022');
    expect(connection[0].port).toBe(55432);

    const sellerId = 'xml-atomic-seller-20261022';
    const prefix = `xml-success-${Date.now()}`;
    await prisma.product.createMany({
      data: [1, 2].map((n) => ({
        id: `${prefix}-${n}`,
        sellerId,
        sku: `${prefix.toUpperCase()}-${n}`,
        title: `XML Test Ürünü ${n === 1 ? "A" : "B"}`,
        unitType: "Adet",
        moq: 1,
        basePrice: n === 1 ? 90 : 100,
        stockQuantity: n === 1 ? 100 : 200,
      })),
    });


    const firstBefore = await prisma.product.findUniqueOrThrow({
      where: { id: `${prefix}-1` },
    });

    expect(Number(firstBefore.basePrice)).toBe(90);
    expect(firstBefore.stockQuantity).toBe(100);

    const job = await prisma.productImportJob.create({
      data: {
        sellerId,
        source: ProductImportSource.XML,
        status: ProductImportStatus.READY,
        totalRows: 2,
        readyRows: 2,
        updateRows: 2,
      },
    });

    const feed = await prisma.productXmlFeed.create({
      data: {
        sellerId,
        name: 'XML Başarı Testi',
        url: `https://example.com/xml-success-${job.id}.xml`,
        syncIntervalMinutes: 60,
        syncLockToken: `token-${job.id}`,
        syncLockExpiresAt: new Date(Date.now() + 600000),
      },
    });

    const normalized = (number: number) => ({
      productId: `${prefix}-${number}`,
      sku: `${prefix.toUpperCase()}-${number}`,
      brand: null,
      barcode: null,
      manufacturerCode: null,
      title: `XML Test Ürünü ${number === 1 ? 'A' : 'B'}`,
      description: null,
      categoryId: null,
      categoryPath: null,
      sourceLanguage: 'tr',
      country: null,
      city: null,
      unitType: 'Adet',
      moq: 1,
      quantityStep: 1,
      basePrice: 190,
      leadTimeDays: null,
      stockType: null,
      stockQuantity: 150,
      vatRate: null,
      imageUrlsProvided: false,
      imageUrls: [],
      variantsProvided: false,
      variants: [],
      attributeValuesProvided: false,
      attributeValues: [],
    });

    await prisma.productImportRow.createMany({
      data: [1, 2].map((number) => ({
        jobId: job.id,
        rowNumber: number,
        sku: prefix.toUpperCase() + '-' + number,
        action: ProductImportRowAction.UPDATE,
        productId: `${prefix}-${number}`,
        rawData: {},
        normalized: normalized(number),
      })),
    });

    const catalog = {
      resolveBrandByName: jest.fn().mockResolvedValue(null),
    };

    const service = new ProductImportService(
      prisma as never,
      catalog as never,
      {} as never,
    );

    await service.processFeedJobAtomically(
      { role: Role.SELLER, companyId: sellerId },
      job.id,
      { feedId: feed.id, lockToken: `token-${job.id}`, syncIntervalMinutes: 60 },
    );

    expect(catalog.resolveBrandByName).toHaveBeenCalledTimes(2);

    const firstAfter = await prisma.product.findUniqueOrThrow({
      where: { id: `${prefix}-1` },
    });

    const savedJob = await prisma.productImportJob.findUniqueOrThrow({
      where: { id: job.id },
    });

    const firstRow = await prisma.productImportRow.findFirstOrThrow({
      where: { jobId: job.id, rowNumber: 1 },
    });

    expect(Number(firstAfter.basePrice)).toBe(190);
    expect(firstAfter.stockQuantity).toBe(150);
    const second = await prisma.product.findUniqueOrThrow({ where: { id: `${prefix}-2` } });
    expect(Number(second.basePrice)).toBe(190);
    expect(second.stockQuantity).toBe(150);
    expect(firstRow.processedAt).not.toBeNull();
    expect(savedJob.status).toBe(ProductImportStatus.COMPLETED);
    const savedFeed = await prisma.productXmlFeed.findUniqueOrThrow({ where: { id: feed.id } });
    expect(savedFeed.lastJobId).toBe(job.id);
    expect(savedFeed.lastSuccessAt).not.toBeNull();
    expect(savedFeed.nextSyncAt.getTime() - savedFeed.lastSuccessAt!.getTime()).toBe(3600000);
  });
});
