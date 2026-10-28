import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';
import { IyzicoService } from '../payments/iyzico.service';
import { OrderService } from './order.service';

describe('OrderService', () => {
  let service: OrderService;
  const findUnique = jest.fn();
  const createOrder = jest.fn();
  const findSellerUser = jest.fn();
  const queryRaw = jest.fn();
  const executeRaw = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    queryRaw.mockResolvedValue([]);
    executeRaw.mockResolvedValue(1);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        {
          provide: PrismaService,
          useValue: {
            product: { findUnique },
            order: { create: createOrder },
            user: { findFirst: findSellerUser },
            $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
              callback({
                $queryRaw: queryRaw,
                $executeRaw: executeRaw,
                product: { findUnique },
                order: { create: createOrder },
              })
            ),
          },
        },
        { provide: NotificationService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: IyzicoService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });


  const productWithVariant = (overrides: Record<string, unknown> = {}) => ({
    id: 'product-1',
    sellerId: 'seller-1',
    isActive: true,
    isApproved: true,
    moq: 5,
    quantityStep: 1,
    stockQuantity: 100,
    reservedQuantity: 0,
    basePrice: '90',
    vatRate: 20,
    unitType: 'Adet',
    title: 'Test Ürünü',
    variants: [{
      id: 'variant-1',
      name: '80li Paket',
      sku: 'TEST-80',
      barcode: '8690000000001',
      price: '120',
      stockQuantity: 20,
      reservedQuantity: 0,
      isActive: true,
    }],
    ...overrides,
  });


  it('önceden rezerve edilmiş stok tekrar satılamaz', async () => {
    findUnique.mockResolvedValue(productWithVariant({
      variants: [{
        id: 'variant-1',
        name: '80li Paket',
        price: '120',
        stockQuantity: 20,
        reservedQuantity: 18,
        isActive: true,
      }],
    }));

    await expect(service.createDirect(
      { role: 'BUYER', companyId: 'buyer-1' },
      { productId: 'product-1', variantId: 'variant-1', quantity: 5 },
    )).rejects.toThrow('Yetersiz stok');

    expect(executeRaw).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('eşzamanlı rezervasyon reddedilir ve sipariş kaydedilmez', async () => {
    findUnique.mockResolvedValue(productWithVariant());
    executeRaw.mockResolvedValue(0);

    await expect(service.createDirect(
      { role: 'BUYER', companyId: 'buyer-1' },
      { productId: 'product-1', variantId: 'variant-1', quantity: 5 },
    )).rejects.toThrow('Yeterli satılabilir stok bulunmuyor');

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('başka ürüne ait varyant reddedilir', async () => {
    findUnique.mockResolvedValue(productWithVariant());

    await expect(service.createDirect(
      { role: 'BUYER', companyId: 'buyer-1' },
      { productId: 'product-1', variantId: 'foreign-variant', quantity: 5 },
    )).rejects.toThrow('Seçilen varyant bulunamadı');

    expect(createOrder).not.toHaveBeenCalled();
  });

  it('pasif varyant reddedilir', async () => {
    findUnique.mockResolvedValue(productWithVariant({
      variants: [{
        id: 'variant-1',
        name: '80li Paket',
        isActive: false,
      }],
    }));

    await expect(service.createDirect(
      { role: 'BUYER', companyId: 'buyer-1' },
      { productId: 'product-1', variantId: 'variant-1', quantity: 5 },
    )).rejects.toThrow('Seçilen varyant bulunamadı');

    expect(createOrder).not.toHaveBeenCalled();
  });

  it('varyant stoku yetersizse sipariş oluşturulmaz', async () => {
    findUnique.mockResolvedValue(productWithVariant({
      variants: [{
        id: 'variant-1',
        name: '80li Paket',
        price: '120',
        stockQuantity: 3,
        reservedQuantity: 0,
        isActive: true,
      }],
    }));

    await expect(service.createDirect(
      { role: 'BUYER', companyId: 'buyer-1' },
      { productId: 'product-1', variantId: 'variant-1', quantity: 5 },
    )).rejects.toThrow('Yetersiz stok');

    expect(createOrder).not.toHaveBeenCalled();
  });

  it('varyant fiyatı backend tarafından hesaplanır ve siparişe kaydedilir', async () => {
    findUnique.mockResolvedValue(productWithVariant());
    createOrder.mockResolvedValue({ id: 'order-1' });
    findSellerUser.mockResolvedValue(null);

    await service.createDirect(
      { role: 'BUYER', companyId: 'buyer-1' },
      { productId: 'product-1', variantId: 'variant-1', quantity: 5 },
    );

    expect(createOrder).toHaveBeenCalledTimes(1);

    const data = createOrder.mock.calls[0][0].data;

    expect(data.variantId).toBe('variant-1');
    expect(data.variantName).toBe('80li Paket');
    expect(data.variantSku).toBe('TEST-80');
    expect(data.variantBarcode).toBe('8690000000001');
    expect(data.unitPriceSnapshot.toString()).toBe('120');
    expect(data.totalAmount.toString()).toBe('600');
    expect(data.status).toBe('PENDING_PAYMENT');
  });


  it('beklenen toplam tutar uyuşmazsa sipariş oluşturulmaz', async () => {
    findUnique.mockResolvedValue(productWithVariant());

    await expect(
      service.createDirect(
        { role: 'BUYER', companyId: 'buyer-1' },
        {
          productId: 'product-1',
          variantId: 'variant-1',
          quantity: 5,
          expectedTotalAmount: '599.99',
        },
      ),
    ).rejects.toThrow(
      'Ürün fiyatı değişmiş. Sepeti güncelleyerek tekrar deneyin.',
    );

    expect(executeRaw).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('beklenen toplam tutar doğruysa sipariş oluşturulur', async () => {
    findUnique.mockResolvedValue(productWithVariant());
    createOrder.mockResolvedValue({ id: 'order-price-1' });
    findSellerUser.mockResolvedValue(null);

    await expect(
      service.createDirect(
        { role: 'BUYER', companyId: 'buyer-1' },
        {
          productId: 'product-1',
          variantId: 'variant-1',
          quantity: 5,
          expectedTotalAmount: '600.00',
        },
      ),
    ).resolves.toMatchObject({
      message: 'Sipariş oluşturuldu',
    });

    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(
      createOrder.mock.calls[0][0].data.totalAmount.toString(),
    ).toBe('600');
  });

  it('servis oluşturulur', () => {
    expect(service).toBeDefined();
  });

  it('yalnızca alıcı sipariş oluşturabilir', async () => {
    await expect(
      service.createDirect(
        { role: 'SELLER', companyId: 'seller-1' },
        { productId: 'product-1', quantity: 10 },
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('pasif varyantlar dahil varyantlı ürün doğrudan sipariş edilemez', async () => {
    findUnique.mockResolvedValue({
      id: 'product-1',
      sellerId: 'seller-1',
      isActive: true,
      isApproved: true,
      variants: [{ id: 'inactive-variant-1' }],
    });

    await expect(
      service.createDirect(
        { role: 'BUYER', companyId: 'buyer-1' },
        { productId: 'product-1', quantity: 10 },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      include: {
        seller: true,
        variants: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            price: true,
            stockQuantity: true,
            reservedQuantity: true,
            isActive: true,
          },
        },
      },
    });

    expect(createOrder).not.toHaveBeenCalled();
  });
});
