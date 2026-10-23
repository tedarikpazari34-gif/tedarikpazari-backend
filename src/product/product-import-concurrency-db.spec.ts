import {
  CompanyStatus,
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

run('Manuel yükleme PostgreSQL eşzamanlılık testi', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: testUrl } },
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('iki eşzamanlı istekte ürünleri bir kez oluşturur ve işi tamamlar', async () => {
    const connection = await prisma.$queryRaw<
      Array<{ db: string; port: number }>
    >`SELECT current_database() AS db, inet_server_port() AS port`;

    expect(connection[0].db).toBe('tedarik_xml_atomic_test_20261022');
    expect(connection[0].port).toBe(55432);

    const seller = await prisma.company.create({
      data: {
        name: 'Yerel Eşzamanlı Import Test Satıcısı',
        role: Role.SELLER,
        status: CompanyStatus.APPROVED,
        verified: true,
      },
    });

    const job = await prisma.productImportJob.create({
      data: {
        sellerId: seller.id,
        source: ProductImportSource.EXCEL,
        status: ProductImportStatus.IMPORTING,
        totalRows: 2,
        readyRows: 2,
        newRows: 2,
      },
    });

    const normalized = (number: number) => ({
      productId: null,
      sku: `CONCURRENT-${job.id}-${number}`,
      brand: null,
      barcode: null,
      manufacturerCode: null,
      title: `Eşzamanlı Test Ürünü ${number}`,
      description: null,
      categoryId: null,
      categoryPath: null,
      sourceLanguage: 'tr',
      country: null,
      city: null,
      unitType: 'Adet',
      moq: 1,
      quantityStep: 1,
      basePrice: 90,
      leadTimeDays: null,
      stockType: null,
      stockQuantity: 10,
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
        sku: `CONCURRENT-${job.id}-${number}`,
        action: ProductImportRowAction.NEW,
        rawData: {},
        normalized: normalized(number),
      })),
    });

    const service = new ProductImportService(
      prisma as never,
      {
        resolveBrandByName: jest.fn().mockResolvedValue(null),
      } as never,
      {} as never,
    );

    const user = {
      role: Role.SELLER,
      companyId: seller.id,
    };

    await Promise.all([
      service.processNextBatch(user, job.id, 1),
      service.processNextBatch(user, job.id, 1),
    ]);

    const savedJob = await prisma.productImportJob.findUniqueOrThrow({
      where: { id: job.id },
    });

    const rows = await prisma.productImportRow.findMany({
      where: { jobId: job.id },
    });

    const products = await prisma.product.findMany({
      where: {
        sellerId: seller.id,
      },
    });

    expect(products).toHaveLength(2);
    expect(new Set(products.map((product) => product.sku)).size).toBe(2);
    expect(rows.every((row) => row.processedAt !== null)).toBe(true);
    expect(rows.every((row) => row.productId !== null)).toBe(true);
    expect(savedJob.errorRows).toBe(0);
    expect(savedJob.processedRows).toBe(2);
    expect(savedJob.status).toBe(ProductImportStatus.COMPLETED);
  });
});
