import { CompanyStatus, OrderStatus, Prisma, Role } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('iyzico reservation expiry safety', () => {
  const originalCallbackUrl = process.env.IYZICO_CALLBACK_URL;

  afterEach(() => {
    if (originalCallbackUrl === undefined) {
      delete process.env.IYZICO_CALLBACK_URL;
    } else {
      process.env.IYZICO_CALLBACK_URL = originalCallbackUrl;
    }
    jest.useRealTimers();
  });

  const setup = (minutesOld: number) => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));

    process.env.IYZICO_CALLBACK_URL =
      'https://example.invalid/iyzico/callback';

    const createdAt = new Date(
      Date.now() - minutesOld * 60 * 1000,
    );

    const currentOrder = {
      status: OrderStatus.PENDING_PAYMENT,
      createdAt,
      stockReservationStatus: 'RESERVED',
    };

    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: {
        findUnique: jest.fn().mockResolvedValue(currentOrder),
      },
      paymentAttempt: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'attempt-test' }),
      },
    };

    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-test',
          emailVerified: true,
          company: {
            status: CompanyStatus.APPROVED,
            verified: true,
          },
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-test',
          buyerId: 'buyer-test',
          status: OrderStatus.PENDING_PAYMENT,
          createdAt,
          stockReservationStatus: 'RESERVED',
          totalAmount: new Prisma.Decimal('100.00'),
          payoutAmount: new Prisma.Decimal('97.00'),
          seller: {
            iyzicoSubMerchantKey: 'test-submerchant',
          },
          buyer: {
            address: {
              address: 'Test Sokak No 1',
              district: 'Şişli',
              postalCode: '34300',
              companyType: 'Şahıs',
              fullName: 'Deniz Kaya',
            },
            paymentIdentityNumber: 'encrypted-test-value',
            email: 'test@example.invalid',
            phone: '+905551112233',
            city: 'İstanbul',
            country: 'Turkey',
          },
          product: {
            id: 'product-test',
            title: 'Test Ürünü',
            category: {
              name: 'Gıda',
              parent: null,
            },
          },
          rfq: null,
        }),
      },
      paymentAttempt: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };

    const iyzico = {
      createCheckoutFormInitialize: jest.fn().mockResolvedValue({
        status: 'success',
        token: 'checkout-test-token',
        paymentPageUrl: 'https://example.invalid/payment',
        checkoutFormContent: '<div>Test</div>',
      }),
    };

    const sensitiveData = {
      decrypt: jest.fn().mockReturnValue('12345678901'),
    };

    const service = new PaymentsService(
      prisma as any,
      iyzico as any,
      {} as any,
      sensitiveData as any,
    );

    const initialize = () =>
      service.initializeIyzico(
        {
          role: Role.BUYER,
          id: 'user-test',
          companyId: 'buyer-test',
        },
        'order-test',
        '127.0.0.1',
      );

    return { initialize, tx, prisma, iyzico };
  };


  it('stok rezervasyonu olmayan eski sipariş için iyzico ödemesi başlatılmaz', async () => {
    const { initialize, tx, iyzico } = setup(10);

    tx.order.findUnique.mockResolvedValue({
      status: OrderStatus.PENDING_PAYMENT,
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      stockReservationStatus: 'NONE',
    });

    await expect(initialize()).rejects.toThrow(
      'stok rezervasyonu doğrulanamadı',
    );

    expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
    expect(iyzico.createCheckoutFormInitialize).not.toHaveBeenCalled();
  });

  it('29 dakika 59 saniyelik rezervasyonda ödeme başlatılabilir', async () => {
    const { initialize, tx, iyzico } = setup(29 + 59 / 60);

    await expect(initialize()).resolves.toMatchObject({
      message: 'iyzico init ok',
    });

    expect(tx.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(iyzico.createCheckoutFormInitialize).toHaveBeenCalledTimes(1);
  });

  it('tam 30 dakikalık rezervasyonda ödeme başlatılmaz', async () => {
    const { initialize, tx, iyzico } = setup(30);

    await expect(initialize()).rejects.toThrow(
      'Rezervasyon süresi dolmuş',
    );

    expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
    expect(iyzico.createCheckoutFormInitialize).not.toHaveBeenCalled();
  });

  it('ödeme kilidi beklenirken rezervasyon süresi dolarsa işlem engellenir', async () => {
    const { initialize, tx, iyzico } = setup(29);

    tx.$queryRaw.mockImplementation(async () => {
      jest.setSystemTime(new Date('2026-10-18T12:02:00.000Z'));
      return [];
    });

    await expect(initialize()).rejects.toThrow(
      'Rezervasyon süresi dolmuş',
    );

    expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
    expect(iyzico.createCheckoutFormInitialize).not.toHaveBeenCalled();
  });

  it('45 dakikalık rezervasyon için ödeme başlatılmaz', async () => {
    const { initialize, tx, iyzico } = setup(45);

    await expect(initialize()).rejects.toThrow(
      'Rezervasyon süresi dolmuş',
    );

    expect(tx.paymentAttempt.create).not.toHaveBeenCalled();
    expect(iyzico.createCheckoutFormInitialize).not.toHaveBeenCalled();
  });

  it('10 dakikalık rezervasyon için ödeme başlatılabilir', async () => {
    const { initialize, tx, iyzico } = setup(10);

    await expect(initialize()).resolves.toMatchObject({
      message: 'iyzico init ok',
      orderId: 'order-test',
    });

    expect(tx.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(iyzico.createCheckoutFormInitialize).toHaveBeenCalledTimes(1);

    const checkoutRequest =
      iyzico.createCheckoutFormInitialize.mock.calls[0][0];

    expect(checkoutRequest).not.toHaveProperty('enabledInstallments');

    const attemptData = tx.paymentAttempt.create.mock.calls[0][0].data;

    expect(attemptData.rawRequest).toEqual(
      expect.objectContaining({
        installmentPolicy: 'IYZICO_CHECKOUT',
      }),
    );

    expect(attemptData.rawRequest).not.toHaveProperty(
      'enabledInstallments',
    );
  });
});
