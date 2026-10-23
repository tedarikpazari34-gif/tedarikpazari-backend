import {
  PrismaClient,
  ProductImportRowAction,
  ProductImportSource,
  ProductImportStatus,
  Role,
} from '@prisma/client';
import { ProductImportService } from './product-import.service';
import { ProductRevisionService } from './product-revision.service';

const testUrl =
  'postgresql://nazcetin@127.0.0.1:55432/tedarik_xml_atomic_test_20261022?schema=public';

const run = process.env.RUN_XML_ATOMIC_DB_TEST === '1'
  ? describe
  : describe.skip;

run('Onaylı ürün gerçek PostgreSQL rollback testi', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: testUrl } },
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ikinci ürün hatasında fiyat, stok ve revizyonu geri alır', async () => {
    const connection = await prisma.$queryRaw<
      Array<{ db: string; port: number }>
    >`SELECT current_database() AS db, inet_server_port() AS port`;

    expect(connection[0].db).toBe('tedarik_xml_atomic_test_20261022');
    expect(connection[0].port).toBe(55432);

    const sellerId = 'xml-atomic-seller-20261022';
    const originalTitle = 'Onaylı XML Test Ürünü';

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

    const product = await prisma.product.create({
      data: {
        sellerId,
        sku: `XML-APPROVED-${job.id}`,
        title: originalTitle,
        description: 'Mevcut açıklama',
        unitType: 'Adet',
        moq: 1,
        quantityStep: 1,
        basePrice: 90,
        stockQuantity: 100,
        isApproved: true,
      },
    });

    const normalized = {
      productId: product.id,
      sku: product.sku,
      brand: null,
      barcode: null,
      manufacturerCode: null,
      title: 'Onay bekleyen yeni ürün adı',
      description: 'Mevcut açıklama',
      categoryId: null,
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
    };

    await prisma.productImportRow.createMany({
      data: [
        {
          jobId: job.id,
          rowNumber: 1,
          sku: product.sku,
          action: ProductImportRowAction.UPDATE,
          productId: product.id,
          rawData: {},
          normalized,
        },
        {
          jobId: job.id,
          rowNumber: 2,
          sku: 'INTENTIONAL-WRONG-SKU',
          action: ProductImportRowAction.UPDATE,
          productId: 'xml-atomic-product-2',
          rawData: {},
          normalized: {
            ...normalized,
            productId: 'xml-atomic-product-2',
            sku: 'XML-ATOMIC-2',
          },
        },
      ],
    });

    const catalog = {
      resolveBrandByName: jest.fn().mockResolvedValue(null),
    };

    const revision = new ProductRevisionService(
      prisma as never,
      catalog as never,
    );

    const revisionSpy = jest.spyOn(revision, 'savePendingRevision');

    const service = new ProductImportService(
      prisma as never,
      catalog as never,
      revision as never,
    );

    await expect(
      service.processFeedJobAtomically(
        { role: Role.SELLER, companyId: sellerId },
        job.id,
      ),
    ).rejects.toThrow('SKU bilgisi ön kontrolden sonra değişmiş');

    expect(revisionSpy).toHaveBeenCalledTimes(1);

    const after = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });

    const revisions = await prisma.productRevision.count({
      where: { productId: product.id },
    });

    const firstRow = await prisma.productImportRow.findFirstOrThrow({
      where: { jobId: job.id, rowNumber: 1 },
    });

    const savedJob = await prisma.productImportJob.findUniqueOrThrow({
      where: { id: job.id },
    });

    expect(after.title).toBe(originalTitle);
    expect(Number(after.basePrice)).toBe(90);
    expect(after.stockQuantity).toBe(100);
    expect(revisions).toBe(0);
    expect(firstRow.processedAt).toBeNull();
    expect(savedJob.status).toBe(ProductImportStatus.READY);
  });
});
