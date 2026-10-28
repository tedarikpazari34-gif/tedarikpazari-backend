import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CompanyStatus, Role } from '@prisma/client';
import { ProductService } from './product.service';

describe('Varyant kritik stok esigi guvenligi', () => {
  function setup() {
    const prisma = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'company-1',
          status: CompanyStatus.APPROVED,
          verified: true,
        }),
      },
      productVariant: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'variant-1',
          minStockThreshold: 10,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const service = new ProductService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const seller = {
      id: 'user-1',
      companyId: 'company-1',
      role: Role.SELLER,
    };

    return { service, prisma, seller };
  }

  it('alici varyant esigini degistiremez', async () => {
    const { service, prisma, seller } = setup();

    await expect(
      service.updateVariantStockThreshold(
        { ...seller, role: Role.BUYER },
        'product-1',
        'variant-1',
        20,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('dogrulanmamis satici islem yapamaz', async () => {
    const { service, prisma, seller } = setup();
    prisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      status: CompanyStatus.APPROVED,
      verified: false,
    });

    await expect(
      service.updateVariantStockThreshold(
        seller, 'product-1', 'variant-1', 20,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('baska firmaya ait varyanta erisimi engeller', async () => {
    const { service, prisma, seller } = setup();
    prisma.productVariant.findFirst.mockResolvedValue(null);

    await expect(
      service.updateVariantStockThreshold(
        seller, 'product-1', 'variant-1', 20,
      ),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.productVariant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          productId: 'product-1',
          product: { sellerId: 'company-1' },
        }),
      }),
    );

    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('gecersiz esik degerlerini reddeder', async () => {
    const { service, prisma, seller } = setup();

    for (const value of [-1, 1.5, 2147483648, NaN, undefined]) {
      await expect(
        service.updateVariantStockThreshold(
          seller,
          'product-1',
          'variant-1',
          value as number,
        ),
      ).rejects.toThrow(BadRequestException);
    }

    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('ayni esigi yeniden yazmaz', async () => {
    const { service, prisma, seller } = setup();

    const result = await service.updateVariantStockThreshold(
      seller, 'product-1', 'variant-1', 10,
    );

    expect(result.minStockThreshold).toBe(10);
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('yalnizca esigi ve bildirim durumunu degistirir', async () => {
    const { service, prisma, seller } = setup();

    await service.updateVariantStockThreshold(
      seller, 'product-1', 'variant-1', 25,
    );

    expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'variant-1',
        productId: 'product-1',
        product: { sellerId: 'company-1' },
        minStockThreshold: 10,
      }),
      data: {
        minStockThreshold: 25,
        stockAlertActive: false,
      },
    });
  });

  it('esik degerinin kaldirilmasina izin verir', async () => {
    const { service, prisma, seller } = setup();

    await service.updateVariantStockThreshold(
      seller, 'product-1', 'variant-1', null,
    );

    expect(prisma.productVariant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          minStockThreshold: null,
          stockAlertActive: false,
        },
      }),
    );
  });

  it('eszamanli degisikligi guvenle reddeder', async () => {
    const { service, prisma, seller } = setup();
    prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.updateVariantStockThreshold(
        seller, 'product-1', 'variant-1', 30,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});
