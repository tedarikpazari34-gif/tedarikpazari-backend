import { StockAlertService } from './stock-alert.service';

describe('StockAlertService', () => {
  const originalFlag = process.env.STOCK_ALERT_ENABLED;

  afterAll(() => {
    if (originalFlag === undefined) {
      delete process.env.STOCK_ALERT_ENABLED;
    } else {
      process.env.STOCK_ALERT_ENABLED = originalFlag;
    }
  });

  function setup(overrides: Record<string, unknown> = {}) {
    const product = {
      id: 'product-1',
      sellerId: 'company-1',
      title: 'Test Ürünü',
      stockQuantity: 15,
      reservedQuantity: 6,
      minStockThreshold: 10,
      stockAlertActive: false,
      isActive: true,
      isApproved: true,
      ...overrides,
    };

    const notification = {
      id: 'notification-1',
      userId: 'seller-1',
      type: 'SYSTEM',
      title: 'Kritik stok uyarısı',
      message: 'Test bildirimi',
      link: '/seller/products',
      isRead: false,
      createdAt: new Date(),
    };

    const tx = {
      product: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      notification: {
        create: jest.fn().mockResolvedValue(notification),
      },
    };

    const prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([product]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productVariant: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'seller-1' }]),
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };

    const notifications = {
      publishStoredNotification: jest.fn(),
    };

    const service = new StockAlertService(
      prisma as any,
      notifications as any,
    );

    return { service, prisma, tx, notifications };
  }

  beforeEach(() => {
    process.env.STOCK_ALERT_ENABLED = 'true';
  });

  it('kritik seviyede tek bildirim kaydeder', async () => {
    const { service, prisma, tx, notifications } = setup();

    await service.checkCriticalStock();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stockAlertActive: true },
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(notifications.publishStoredNotification)
      .toHaveBeenCalledTimes(1);
  });

  it('aktif stok uyarisini tekrar gondermez', async () => {
    const { service, prisma, notifications } = setup({
      stockAlertActive: true,
    });

    await service.checkCriticalStock();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notifications.publishStoredNotification)
      .not.toHaveBeenCalled();
  });

  it('stok yukselince uyari durumunu sifirlar', async () => {
    const { service, prisma, notifications } = setup({
      stockQuantity: 40,
      reservedQuantity: 2,
      stockAlertActive: true,
    });

    await service.checkCriticalStock();

    expect(prisma.product.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stockAlertActive: false },
      }),
    );
    expect(notifications.publishStoredNotification)
      .not.toHaveBeenCalled();
  });

  it('baska islem uyariyi sahiplendiyse tekrar bildirmez', async () => {
    const { service, tx, notifications } = setup();

    tx.product.updateMany.mockResolvedValue({ count: 0 });

    await service.checkCriticalStock();

    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(notifications.publishStoredNotification)
      .not.toHaveBeenCalled();
  });

  it('ozellik kapaliyken stok sorgusu yapmaz', async () => {
    process.env.STOCK_ALERT_ENABLED = 'false';

    const { service, prisma } = setup();

    await service.checkCriticalStock();

    expect(prisma.product.findMany).not.toHaveBeenCalled();
    expect(prisma.productVariant.findMany).not.toHaveBeenCalled();
  });

  it('varyant stok dususunde bildirim olusturur', async () => {
    const { service, prisma, tx, notifications } = setup();

    prisma.product.findMany.mockResolvedValue([]);

    prisma.productVariant.findMany.mockResolvedValue([{
      id: 'variant-1',
      name: 'Büyük Boy',
      stockQuantity: 8,
      reservedQuantity: 3,
      minStockThreshold: 5,
      stockAlertActive: false,
      isActive: true,
      product: {
        sellerId: 'company-1',
        title: 'Test Ürünü',
        isActive: true,
        isApproved: true,
      },
    }]);

    await service.checkCriticalStock();

    expect(tx.productVariant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stockAlertActive: true },
      }),
    );
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
    expect(notifications.publishStoredNotification)
      .toHaveBeenCalledTimes(1);
  });
});
