import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductService } from './product.service';

describe('ProductService seller revision history security', () => {
  const prisma = {
    product: { findFirst: jest.fn() },
    productRevision: { findMany: jest.fn() },
    brand: { findMany: jest.fn() },
  };

  let service: ProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.product.findFirst.mockResolvedValue({ id: 'product-1' });
    prisma.productRevision.findMany.mockResolvedValue([]);
    prisma.brand.findMany.mockResolvedValue([]);

    service = new ProductService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  const seller = { role: Role.SELLER, companyId: 'seller-1' };

  it('satıcı kendi ürününün revizyon geçmişini görebilir', async () => {
    const revisions = [{
      id: 'revision-1',
      status: 'REJECTED',
      rejectionReason: 'Eksik açıklama',
    }];
    prisma.productRevision.findMany.mockResolvedValue(revisions);

    await expect(
      service.listMyProductRevisions(seller, 'product-1'),
    ).resolves.toEqual(
      revisions.map((revision) => ({ ...revision, brandName: null })),
    );

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'product-1', sellerId: 'seller-1' },
      select: { id: true },
    });

    expect(prisma.productRevision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: 'product-1', sellerId: 'seller-1' },
      }),
    );
  });

  it('revizyondaki marka kimliğini marka adına dönüştürür', async () => {
    prisma.productRevision.findMany.mockResolvedValue([{
      id: 'revision-brand',
      proposedData: { brandId: 'brand-1' },
      status: 'PENDING',
    }]);
    prisma.brand.findMany.mockResolvedValue([
      { id: 'brand-1', name: 'Örnek Marka' },
    ]);

    const result = await service.listMyProductRevisions(
      seller,
      'product-1',
    );

    expect(result[0].brandName).toBe('Örnek Marka');
    expect(prisma.brand.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['brand-1'] } },
      select: { id: true, name: true },
    });
  });

  it('başka satıcının ürününe erişimi engeller', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.listMyProductRevisions(seller, 'other-product'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.productRevision.findMany).not.toHaveBeenCalled();
  });

  it.each([Role.BUYER, Role.ADMIN])(
    '%s rolünün satıcı geçmişine erişimini reddeder',
    async (role) => {
      await expect(
        service.listMyProductRevisions(
          { role, companyId: 'seller-1' },
          'product-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.product.findFirst).not.toHaveBeenCalled();
      expect(prisma.productRevision.findMany).not.toHaveBeenCalled();
    },
  );

  it('bulunamayan ürün için hata döndürür', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.listMyProductRevisions(seller, 'missing-product'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.productRevision.findMany).not.toHaveBeenCalled();
  });
});
