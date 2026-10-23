import {
  CompanyStatus,
  PrismaClient,
  ProductImportSource,
  ProductImportStatus,
  Role,
} from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { ProductImportService } from './product-import.service';

const testUrl =
  'postgresql://nazcetin@127.0.0.1:55432/tedarik_xml_atomic_test_20261022?schema=public';

const run = process.env.RUN_XML_ATOMIC_DB_TEST === '1'
  ? describe
  : describe.skip;

run('Yükleme geçmişi PostgreSQL satıcı izolasyonu', () => {
  const prisma = new PrismaClient({
    datasources: { db: { url: testUrl } },
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('satıcı kayıtlarını ayırır, sayfalar ve doğrulamayı uygular', async () => {
    const connection = await prisma.$queryRaw<
      Array<{ db: string; port: number }>
    >`SELECT current_database() AS db, inet_server_port() AS port`;

    expect(connection[0].db).toBe('tedarik_xml_atomic_test_20261022');
    expect(connection[0].port).toBe(55432);

    const sellerA = await prisma.company.create({
      data: {
        name: 'Yerel Import Geçmiş Test Satıcısı A',
        role: Role.SELLER,
        status: CompanyStatus.APPROVED,
        verified: true,
      },
    });

    const sellerB = await prisma.company.create({
      data: {
        name: 'Yerel Import Geçmiş Test Satıcısı B',
        role: Role.SELLER,
        status: CompanyStatus.APPROVED,
        verified: true,
      },
    });

    const unverified = await prisma.company.create({
      data: {
        name: 'Yerel Import Geçmiş Test Onaysız Satıcı',
        role: Role.SELLER,
        status: CompanyStatus.PENDING,
        verified: false,
      },
    });

    const a1 = await prisma.productImportJob.create({
      data: {
        sellerId: sellerA.id,
        source: ProductImportSource.EXCEL,
        status: ProductImportStatus.COMPLETED,
        originalFileName: 'satıcı-a-1.xlsx',
      },
    });

    const a2 = await prisma.productImportJob.create({
      data: {
        sellerId: sellerA.id,
        source: ProductImportSource.XML,
        status: ProductImportStatus.COMPLETED,
        originalFileName: 'satıcı-a-2.xml',
      },
    });

    const b1 = await prisma.productImportJob.create({
      data: {
        sellerId: sellerB.id,
        source: ProductImportSource.EXCEL,
        status: ProductImportStatus.COMPLETED,
        originalFileName: 'satıcı-b.xlsx',
      },
    });

    const service = new ProductImportService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const userA = { role: Role.SELLER, companyId: sellerA.id };
    const userB = { role: Role.SELLER, companyId: sellerB.id };

    const historyA = await service.listJobs(userA, 1, 20);
    expect(historyA.total).toBe(2);
    expect(historyA.jobs.map((job) => job.id).sort()).toEqual(
      [a1.id, a2.id].sort(),
    );
    expect(historyA.jobs.some((job) => job.id === b1.id)).toBe(false);

    const historyB = await service.listJobs(userB, 1, 20);
    expect(historyB.total).toBe(1);
    expect(historyB.jobs.map((job) => job.id)).toEqual([b1.id]);

    const page1 = await service.listJobs(userA, 1, 1);
    const page2 = await service.listJobs(userA, 2, 1);
    expect(page1.totalPages).toBe(2);
    expect(page1.jobs).toHaveLength(1);
    expect(page2.jobs).toHaveLength(1);
    expect(page1.jobs[0].id).not.toBe(page2.jobs[0].id);

    await expect(
      service.listJobs(
        { role: Role.SELLER, companyId: unverified.id },
        1,
        20,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
