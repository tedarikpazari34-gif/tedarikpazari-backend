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

  it('XML başarı kaydı başarısızsa iki ürün geri alınır', async () => {
    const connection = await prisma.$queryRaw<
      Array<{ db: string; port: number }>
    >`SELECT current_database() AS db, inet_server_port() AS port`;

    expect(connection[0].db).toBe('tedarik_xml_atomic_test_20261022');
    expect(connection[0].port).toBe(55432);

    const sellerId = 'xml-atomic-seller-20261022';

    const firstBefore = await prisma.product.findUniqueOrThrow({
      where: { id: 'xml-atomic-product-1' },
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

    const normalized = (number: number) => ({
      productId: `xml-atomic-product-${number}`,
      sku: `XML-ATOMIC-${number}`,
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
        sku: 'XML-ATOMIC-' + number,
        action: ProductImportRowAction.UPDATE,
        productId: `xml-atomic-product-${number}`,
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

    await expect(
      service.processFeedJobAtomically(
        { role: Role.SELLER, companyId: sellerId },
        job.id,
        { feedId: 'missing-feed', lockToken: 'test-token', syncIntervalMinutes: 60 },
      ),
    ).rejects.toThrow('XML feed senkronizasyon kilidi kaybedildi');

    expect(catalog.resolveBrandByName).toHaveBeenCalledTimes(2);

    const firstAfter = await prisma.product.findUniqueOrThrow({
      where: { id: 'xml-atomic-product-1' },
    });

    const savedJob = await prisma.productImportJob.findUniqueOrThrow({
      where: { id: job.id },
    });

    const firstRow = await prisma.productImportRow.findFirstOrThrow({
      where: { jobId: job.id, rowNumber: 1 },
    });

    expect(Number(firstAfter.basePrice)).toBe(90);
    expect(firstAfter.stockQuantity).toBe(100);
    const second = await prisma.product.findUniqueOrThrow({ where: { id: 'xml-atomic-product-2' } });
    expect(Number(second.basePrice)).toBe(100);
    expect(second.stockQuantity).toBe(200);
    expect(firstRow.processedAt).toBeNull();
    expect(savedJob.status).toBe(ProductImportStatus.READY);
  });
});
