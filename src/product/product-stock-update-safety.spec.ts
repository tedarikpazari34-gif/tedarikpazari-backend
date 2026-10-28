import { BadRequestException } from '@nestjs/common';
import { CompanyStatus, Role } from '@prisma/client';
import { ProductService } from './product.service';

describe('ProductService stock update safety', () => {
  const setup = (isApproved = false) => {
    const product = {
      id: 'product-1',
      sellerId: 'seller-1',
      categoryId: null,
      isApproved,
    };

    const tx: any = {
      product: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(product),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      productVariant: {
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
    };

    const prisma: any = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'seller-1',
          status: CompanyStatus.APPROVED,
          verified: true,
        }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
      },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };

    const catalog: any = {
      normalizeVariants: jest.fn().mockReturnValue([]),
    };

    const service = new ProductService(
      prisma,
      {} as any,
      catalog,
      {} as any,
    );

    const update = (body: any) =>
      service.update(
        { role: Role.SELLER, companyId: 'seller-1' },
        product.id,
        body,
      );

    return { tx, update };
  };

  it('stok rezervasyonun altına düşerse güncellemeyi reddeder', async () => {
    const { tx, update } = setup(true);
    tx.product.updateMany.mockResolvedValue({ count: 0 });

    await expect(update({ stockQuantity: 20 })).rejects.toThrow(
      BadRequestException,
    );

    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'product-1',
          reservedQuantity: { lte: 20 },
        }),
        data: expect.objectContaining({
          stockQuantity: 20,
        }),
      }),
    );
  });

  it('sipariş geçmişi olan varyantın silinmesini engeller', async () => {
    const { tx, update } = setup();
    tx.order.findFirst.mockResolvedValue({ id: 'order-1' });

    await expect(update({ variants: [] })).rejects.toThrow(
      'Sipariş geçmişi olan ürünün varyantları silinip yeniden oluşturulamaz',
    );

    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
    expect(tx.productVariant.createMany).not.toHaveBeenCalled();
  });

  it('rezervasyonu bulunan varyantın silinmesini engeller', async () => {
    const { tx, update } = setup();
    tx.productVariant.findFirst.mockResolvedValue({
      id: 'variant-1',
    });

    await expect(update({ variants: [] })).rejects.toThrow(
      'Stok rezervasyonu bulunan varyantlar silinemez',
    );

    expect(tx.productVariant.findFirst).toHaveBeenCalledWith({
      where: {
        productId: 'product-1',
        reservedQuantity: { gt: 0 },
      },
      select: { id: true },
    });

    expect(tx.productVariant.deleteMany).not.toHaveBeenCalled();
  });
});
