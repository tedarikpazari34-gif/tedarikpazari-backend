import { Role } from '@prisma/client';
import { OrderService } from './order.service';

describe('OrderService - purchase snapshots', () => {
  const buyer = {
    role: Role.BUYER,
    companyId: 'buyer-1',
  };

  const setup = (overrides: Record<string, unknown> = {}) => {
    const product = {
      id: 'product-1',
      title: 'Orijinal Urun Adi',
      sku: 'SKU-ORIJINAL',
      sellerId: 'seller-1',
      seller: { id: 'seller-1' },
      isActive: true,
      isApproved: true,
      archivedAt: null,
      moq: 5,
      quantityStep: 1,
      unitType: 'ADET',
      basePrice: '90.25',
      vatRate: 20,
      stockQuantity: 1000,
      reservedQuantity: 0,
      variants: [] as any[],
      ...overrides,
    };

    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'product-1' },
      ]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
      },
      order: {
        create: jest.fn().mockImplementation(
          async ({ data }: any) => ({
            id: 'order-test',
            ...data,
          }),
        ),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    prisma.$transaction = jest.fn(
      async (callback: (tx: any) => Promise<any>) =>
        callback(prisma),
    );

    const service = new OrderService(
      prisma as any,
      { createNotification: jest.fn() } as any,
      {} as any,
      {} as any,
    );

    return { service, prisma, product };
  };

  it('normal urunun adini SKU ve birimini sabitler', async () => {
    const { service, prisma } = setup();

    await service.createDirect(buyer, {
      productId: 'product-1',
      quantity: 10,
    } as any);

    expect(prisma.order.create).toHaveBeenCalledTimes(1);

    const data = prisma.order.create.mock.calls[0][0].data;

    expect(data.productTitleSnapshot).toBe(
      'Orijinal Urun Adi',
    );
    expect(data.productSkuSnapshot).toBe(
      'SKU-ORIJINAL',
    );
    expect(data.unitTypeSnapshot).toBe('ADET');
    expect(data.unitPriceSnapshot.toString()).toBe('90.25');
    expect(data.variantId).toBeNull();
  });

  it('varyant fiyatini ve varyant kimligini sabitler', async () => {
    const { service, prisma } = setup({
      moq: 12,
      quantityStep: 7,
      variants: [{
        id: 'variant-1',
        name: '80li Paket',
        sku: 'VARYANT-80',
        barcode: '8690000000001',
        price: '120',
        stockQuantity: 100,
        reservedQuantity: 0,
        isActive: true,
      }],
    });

    await service.createDirect(buyer, {
      productId: 'product-1',
      variantId: 'variant-1',
      quantity: 24,
    } as any);

    const data = prisma.order.create.mock.calls[0][0].data;

    expect(data.quantity).toBe(24);
    expect(data.variantId).toBe('variant-1');
    expect(data.variantName).toBe('80li Paket');
    expect(data.variantSku).toBe('VARYANT-80');
    expect(data.variantBarcode).toBe('8690000000001');
    expect(data.unitPriceSnapshot.toString()).toBe('120');
    expect(data.productTitleSnapshot).toBe(
      'Orijinal Urun Adi',
    );
    expect(data.productSkuSnapshot).toBe(
      'SKU-ORIJINAL',
    );
  });

  it('eski urunde SKU yoksa bilgi uydurmaz', async () => {
    const { service, prisma } = setup({
      sku: null,
    });

    await service.createDirect(buyer, {
      productId: 'product-1',
      quantity: 5,
    } as any);

    const data = prisma.order.create.mock.calls[0][0].data;

    expect(data.productSkuSnapshot).toBeNull();
    expect(data.productTitleSnapshot).toBe(
      'Orijinal Urun Adi',
    );
    expect(data.unitTypeSnapshot).toBe('ADET');
  });

  it('urun sonradan degisse de ilk siparis snapshot kalir', async () => {
    const { service, prisma, product } = setup();

    await service.createDirect(buyer, {
      productId: 'product-1',
      quantity: 5,
    } as any);

    const first = prisma.order.create.mock.calls[0][0].data;

    product.title = 'XML Ile Guncellenen Urun';
    product.sku = 'SKU-YENI';
    product.basePrice = '150';

    await service.createDirect(buyer, {
      productId: 'product-1',
      quantity: 5,
    } as any);

    const second = prisma.order.create.mock.calls[1][0].data;

    expect(first.productTitleSnapshot).toBe(
      'Orijinal Urun Adi',
    );
    expect(first.productSkuSnapshot).toBe('SKU-ORIJINAL');
    expect(first.unitPriceSnapshot.toString()).toBe('90.25');

    expect(second.productTitleSnapshot).toBe(
      'XML Ile Guncellenen Urun',
    );
    expect(second.productSkuSnapshot).toBe('SKU-YENI');
    expect(second.unitPriceSnapshot.toString()).toBe('150');
  });
});
