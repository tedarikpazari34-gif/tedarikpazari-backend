import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CompanyStatus, Role } from '@prisma/client';
import { ProductService } from './product.service';

describe('ProductService.archiveMine', () => {
  const seller = {
    role: Role.SELLER,
    companyId: 'seller-1',
  };

  let service: ProductService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'seller-1',
          status: CompanyStatus.APPROVED,
          verified: true,
        }),
      },
      product: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'product-1',
          archivedAt: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    prisma.$transaction = jest.fn().mockImplementation(
      async (callback: (tx: any) => Promise<any>) => callback(prisma),
    );
    prisma.$queryRaw = jest.fn().mockResolvedValue([
      { id: 'product-1' },
    ]);

    service = new ProductService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('saticinin kendi urununu guvenli arsivler', async () => {
    const result = await service.archiveMine(seller, 'product-1');

    expect(result.archived).toBe(true);

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'product-1',
        sellerId: 'seller-1',
      },
      select: {
        id: true,
        archivedAt: true,
      },
    });

    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'product-1',
        sellerId: 'seller-1',
        archivedAt: null,
        reservedQuantity: 0,
        variants: {
          none: {
            reservedQuantity: { gt: 0 },
          },
        },
      },
      data: {
        archivedAt: expect.any(Date),
        isActive: false,
        stockAlertActive: false,
      },
    });
  });

  it('baska saticinin urununu arsivleyemez', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(
      service.archiveMine(seller, 'another-product'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('dogrulanmamis satuciya izin vermez', async () => {
    prisma.company.findUnique.mockResolvedValue({
      id: 'seller-1',
      status: CompanyStatus.APPROVED,
      verified: false,
    });

    await expect(
      service.archiveMine(seller, 'product-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('satici olmayan kullaniciyi reddeder', async () => {
    await expect(
      service.archiveMine(
        { role: Role.BUYER, companyId: 'seller-1' },
        'product-1',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('rezervasyon veya durum degisikliginde arsivlemeyi reddeder', async () => {
    prisma.product.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.archiveMine(seller, 'product-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('arsivlenmis urunde tekrar guvenli sonuc dondurur', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'product-1',
      archivedAt: new Date('2026-10-29T00:00:00Z'),
    });

    const result = await service.archiveMine(seller, 'product-1');

    expect(result.archived).toBe(true);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('urun satirini kilitlemeden arsivleme yapmaz', async () => {
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.archiveMine(seller, 'product-1'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.product.findFirst).not.toHaveBeenCalled();
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('urun kaydini fiziksel olarak silmez', async () => {
    await service.archiveMine(seller, 'product-1');

    expect(prisma.product.delete).not.toHaveBeenCalled();
    expect(prisma.product.deleteMany).not.toHaveBeenCalled();
  });
});
