import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('iyzico stock commitment safety', () => {
  const setup = (options: {
    installment?: number;
    paidPrice?: string;
    merchantCommissionRateAmount?: string;
    allowedInstallments?: number[];
    iyzicoManaged?: boolean;
    reportedSubMerchantPrice?: string | null;
  } = {}) => {
    const order = {
      id: 'order-stock',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      productId: 'product-1',
      variantId: 'variant-1',
      quantity: 5,
      stockReservationStatus: 'RESERVED',
      status: OrderStatus.PENDING_PAYMENT,
      totalAmount: new Prisma.Decimal('100.00'),
      escrowAmount: new Prisma.Decimal('100.00'),
      commissionAmount: new Prisma.Decimal('10.00'),
      payoutAmount: new Prisma.Decimal('90.00'),
    };

    const prisma: any = {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      paymentAttempt: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'attempt-stock',
          orderId: 'order-stock',
          status: PaymentStatus.INITIATED,
          rawRequest: {
            enabledInstallments: options.allowedInstallments ?? [1],
            ...(options.iyzicoManaged
              ? { installmentPolicy: 'IYZICO_CHECKOUT' }
              : {}),
          },
        }),
        findUnique: jest.fn().mockResolvedValue({
          status: PaymentStatus.INITIATED,
        }),
      },
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      product: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productVariant: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      companyWallet: {
        update: jest.fn().mockResolvedValue({}),
      },
      ledgerEntry: {
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    prisma.$transaction = jest.fn(async (callback: any) =>
      callback(prisma),
    );

    const service = new PaymentsService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
    );

    jest.spyOn(service as any, 'ensureWallet')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'markPaymentAttemptSuccess')
      .mockResolvedValue(undefined);
    const markReview = jest.spyOn(
      service as any,
      'markPaymentAttemptReview',
    ).mockResolvedValue(undefined);

    const execute = () =>
      (service as any).processSuccessfulPayment(
        'attempt-stock',
        'order-stock',
        'token-stock',
        {
          status: 'success',
          paymentStatus: 'SUCCESS',
          paymentId: 'payment-stock',
          price: '100.00',
          paidPrice: options.paidPrice ?? '100.00',
          currency: 'TRY',
          installment: options.installment ?? 1,
          merchantCommissionRateAmount:
            options.merchantCommissionRateAmount ?? '0.00',
          fraudStatus: 1,
          itemTransactions: [{
            itemId: 'basket-item-stock',
            paymentTransactionId: 'transaction-stock',
            subMerchantPrice:
              options.reportedSubMerchantPrice === undefined
                ? '90.00'
                : options.reportedSubMerchantPrice,
          }],
        },
        'basket-item-stock',
        'conversation-stock',
      );

    return { order, prisma, execute, markReview };
  };


  it('izinli 3 taksit ve doğru vade farkı başarılı işlenir', async () => {
    const { prisma, execute, markReview } = setup({
      installment: 3,
      paidPrice: '110.00',
      merchantCommissionRateAmount: '10.00',
      allowedInstallments: [1, 3],
    });

    await expect(execute()).resolves.toMatchObject({
      message: 'Payment verified and order marked as PAID',
    });

    expect(prisma.paymentTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: new Prisma.Decimal('100.00'),
      }),
    });
    expect(prisma.productVariant.updateMany).toHaveBeenCalledTimes(1);
    expect(markReview).not.toHaveBeenCalled();
  });

  it('hatalı vade farkında taksitli ödeme incelemeye alınır', async () => {
    const { prisma, execute, markReview } = setup({
      installment: 3,
      paidPrice: '110.00',
      merchantCommissionRateAmount: '5.00',
      allowedInstallments: [1, 3],
    });

    await expect(execute()).rejects.toThrow('mutabakat gerekli');

    expect(markReview).toHaveBeenCalledTimes(1);
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('izin verilmeyen 3 taksit doğru tutarla bile reddedilir', async () => {
    const { prisma, execute, markReview } = setup({
      installment: 3,
      paidPrice: '110.00',
      merchantCommissionRateAmount: '10.00',
      allowedInstallments: [1],
    });

    await expect(execute()).rejects.toThrow('mutabakat gerekli');

    expect(markReview).toHaveBeenCalledTimes(1);
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });


  it('iyzico yönetiminde geçerli 3 taksit kabul edilir', async () => {
    const { prisma, execute, markReview } = setup({
      installment: 3,
      paidPrice: '110.00',
      merchantCommissionRateAmount: '10.00',
      allowedInstallments: [1],
      iyzicoManaged: true,
    });

    await expect(execute()).resolves.toMatchObject({
      message: 'Payment verified and order marked as PAID',
    });

    expect(prisma.paymentTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.updateMany).toHaveBeenCalledTimes(1);
    expect(markReview).not.toHaveBeenCalled();
  });

  it('iyzico yönetiminde desteklenmeyen 5 taksit reddedilir', async () => {
    const { prisma, execute, markReview } = setup({
      installment: 5,
      paidPrice: '110.00',
      merchantCommissionRateAmount: '10.00',
      iyzicoManaged: true,
    });

    await expect(execute()).rejects.toThrow('mutabakat gerekli');

    expect(markReview).toHaveBeenCalledTimes(1);
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });


  it('yanlış satıcı hakedişi incelemeye alınır', async () => {
    const { prisma, execute, markReview } = setup({
      reportedSubMerchantPrice: '89.00',
    });

    await expect(execute()).rejects.toThrow('mutabakat gerekli');
    expect(markReview).toHaveBeenCalledTimes(1);
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('eksik satıcı hakedişi incelemeye alınır', async () => {
    const { prisma, execute, markReview } = setup({
      reportedSubMerchantPrice: null,
    });

    await expect(execute()).rejects.toThrow('mutabakat gerekli');
    expect(markReview).toHaveBeenCalledTimes(1);
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
  });

  it('ilk başarılı ödemede varyant stokunu bir kez kesinleştirir', async () => {
    const { prisma, execute } = setup();

    await expect(execute()).resolves.toMatchObject({
      message: 'Payment verified and order marked as PAID',
    });

    expect(prisma.productVariant.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'variant-1',
        productId: 'product-1',
        reservedQuantity: { gte: 5 },
        OR: [
          { stockQuantity: null },
          { stockQuantity: { gte: 5 } },
        ],
      },
      data: {
        reservedQuantity: { decrement: 5 },
        stockQuantity: { decrement: 5 },
      },
    });

    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-stock',
        status: OrderStatus.PAID,
        stockReservationStatus: 'RESERVED',
      },
      data: {
        stockReservationStatus: 'COMMITTED',
      },
    });

    expect(prisma.paymentTransaction.create).toHaveBeenCalledTimes(1);
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
  });

  it('aynı başarılı ödeme tekrar geldiğinde stok ikinci kez düşmez', async () => {
    const { order, prisma, execute } = setup();

    prisma.order.findUnique.mockResolvedValue({
      ...order,
      status: OrderStatus.PAID,
      stockReservationStatus: 'COMMITTED',
      iyzicoPaymentId: 'payment-stock',
      iyzicoPaymentTransactionId: 'transaction-stock',
      iyzicoCheckoutToken: 'token-stock',
      iyzicoConversationId: 'conversation-stock',
    });

    prisma.order.updateMany.mockResolvedValue({ count: 0 });
    prisma.paymentAttempt.findFirst.mockResolvedValue({
      id: 'attempt-stock',
      orderId: 'order-stock',
      status: PaymentStatus.SUCCESS,
      iyzicoPaymentId: 'payment-stock',
    });

    prisma.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order-stock',
      sellerId: 'seller-1',
      amount: new Prisma.Decimal('100.00'),
    });

    await expect(execute()).resolves.toMatchObject({
      message: 'Order zaten aynı iyzico ödemesiyle işlenmiş',
    });

    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('rezervasyon kesinleştirilemezse ödeme kaydını ilerletmez', async () => {
    const { prisma, execute, markReview } = setup();

    prisma.productVariant.updateMany.mockResolvedValue({ count: 0 });

    await expect(execute()).rejects.toThrow(
      'Stok kesinleştirilemedi; mutabakat gerekli',
    );

    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
    expect(prisma.companyWallet.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(markReview).toHaveBeenCalled();
  });

  it('normal ürün stok rezervasyonu ödemede kesinleştirilir', async () => {
    const { order, prisma, execute } = setup();

    prisma.order.findUnique.mockResolvedValue({
      ...order,
      variantId: null,
    });

    await expect(execute()).resolves.toMatchObject({
      message: 'Payment verified and order marked as PAID',
    });

    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'product-1',
        reservedQuantity: { gte: 5 },
        OR: [
          { stockQuantity: null },
          { stockQuantity: { gte: 5 } },
        ],
      },
      data: {
        reservedQuantity: { decrement: 5 },
        stockQuantity: { decrement: 5 },
      },
    });

    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('eski rezervasyonsuz siparişin başarılı ödemesi incelemeye alınır', async () => {
    const { order, prisma, execute, markReview } = setup();

    prisma.order.findUnique.mockResolvedValue({
      ...order,
      stockReservationStatus: 'NONE',
    });

    await expect(execute()).rejects.toThrow(
      'Rezervasyonsuz eski sipariş için başarılı iyzico ödemesi alındı',
    );

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
    expect(prisma.companyWallet.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(markReview).toHaveBeenCalledTimes(1);
  });

  it('önceden serbest bırakılmış stok ödeme sırasında kabul edilmez', async () => {
    const { order, prisma, execute, markReview } = setup();

    prisma.order.findUnique.mockResolvedValue({
      ...order,
      stockReservationStatus: 'RELEASED',
    });

    await expect(execute()).rejects.toThrow(
      'Ödeme sonrası stok durumu tutarsız; mutabakat gerekli',
    );

    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentTransaction.create).not.toHaveBeenCalled();
    expect(markReview).toHaveBeenCalled();
  });

});
