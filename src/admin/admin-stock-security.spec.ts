import { ForbiddenException } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('Admin kritik stok guvenligi', () => {
  it('urun listesi JWT ve AdminGuard ile korunur', () => {
    const method = AdminController.prototype.listAllProducts;
    const guards = Reflect.getMetadata('__guards__', method) || [];
    const names = guards.map((guard: any) => guard.name);

    expect(names).toEqual(
      expect.arrayContaining(['JwtAuthGuard', 'AdminGuard']),
    );
  });

  it('controller ek admin kontrolunu atlamaz', () => {
    const checkAdmin = jest.fn(() => {
      throw new ForbiddenException('Yetkisiz islem');
    });
    const listAllProducts = jest.fn();

    expect(() =>
      AdminController.prototype.listAllProducts.call(
        { checkAdmin, adminService: { listAllProducts } } as any,
        { user: { role: 'BUYER' } },
      ),
    ).toThrow(ForbiddenException);

    expect(checkAdmin).toHaveBeenCalledTimes(1);
    expect(listAllProducts).not.toHaveBeenCalled();
  });

  it('admin sorgusu varyant stok alanlarini getirir', async () => {
    const prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    await AdminService.prototype.listAllProducts.call(
      { prisma } as any,
    );

    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);

    const query = prisma.product.findMany.mock.calls[0][0];

    expect(query).toMatchObject({
      include: {
        seller: true,
        category: true,
        variants: {
          select: {
            id: true,
            name: true,
            isActive: true,
            stockQuantity: true,
            reservedQuantity: true,
            minStockThreshold: true,
          },
        },
      },
    });
  });

  it('admin urun sonucunu degistirmeden iletir', async () => {
    const products = [{
      id: 'product-1',
      title: 'Ornek urun',
      stockQuantity: 20,
      reservedQuantity: 5,
      minStockThreshold: 10,
      variants: [{
        id: 'variant-1',
        name: 'Buyuk boy',
        stockQuantity: 8,
        reservedQuantity: 2,
        minStockThreshold: 7,
      }],
    }];

    const prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue(products),
      },
    };

    const result = await AdminService.prototype.listAllProducts.call(
      { prisma } as any,
    );

    expect(result).toEqual(products);
  });
});
