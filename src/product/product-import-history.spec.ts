import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductImportService } from './product-import.service';

describe('ProductImportService history security', () => {
  const prisma = {
    productImportJob: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const user = { role: Role.SELLER, companyId: 'seller-1' };
  let service: ProductImportService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.productImportJob.count.mockResolvedValue(1);
    prisma.productImportJob.findMany.mockResolvedValue([{ id: 'job-1' }]);
    prisma.$transaction.mockImplementation(
      async (operations: Promise<unknown>[]) => Promise.all(operations),
    );
    service = new ProductImportService(
      prisma as never, {} as never, {} as never,
    );
    jest.spyOn(service as any, 'requireVerifiedSellerCompany')
      .mockResolvedValue({ id: 'seller-1' });
  });

  it('yalnızca satıcının şirket kayıtlarını listeler', async () => {
    const result = await service.listJobs(user);
    expect(result.total).toBe(1);
    expect(result.jobs).toEqual([{ id: 'job-1' }]);
    expect(prisma.productImportJob.count).toHaveBeenCalledWith({
      where: { sellerId: 'seller-1' },
    });
    expect(prisma.productImportJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sellerId: 'seller-1' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 20,
      }),
    );
  });

  it('sayfa ve limit değerlerini güvenli sınırlar içinde tutar', async () => {
    await service.listJobs(user, -5, 999);
    expect(prisma.productImportJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    );
  });

  it('satıcı doğrulaması başarısızsa kayıtları sorgulamaz', async () => {
    jest.spyOn(service as any, 'requireVerifiedSellerCompany')
      .mockRejectedValue(new ForbiddenException('Yetkisiz'));
    await expect(service.listJobs(user)).rejects.toThrow(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
