import { PaymentStatus, Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('iyzico payment safety', () => {
  it('keeps a potentially captured payment in REVIEW when paymentId is missing', async () => {
    const attempt = {
      id: 'attempt-test',
      orderId: 'order-test',
      status: PaymentStatus.INITIATED,
      iyzicoPaymentId: null,
    };

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-test',
          totalAmount: new Prisma.Decimal('100.00'),
          status: 'PENDING_PAYMENT',
        }),
      },
      paymentAttempt: {
        findFirst: jest.fn().mockResolvedValue(attempt),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };

    const iyzico = {
      retrieveCheckoutForm: jest.fn(),
      createCheckoutFormInitialize: jest.fn(),
    };

    const service = new PaymentsService(
      prisma as any,
      iyzico as any,
      {} as any,
      {} as any,
    );

    await expect(
      (service as any).processSuccessfulPayment(
        attempt.id,
        attempt.orderId,
        'test-token',
        {
          status: 'success',
          paymentStatus: 'SUCCESS',
          paymentId: null,
          price: '100.00',
          fraudStatus: 1,
        },
        'product-test',
        'conversation-test',
      ),
    ).rejects.toThrow();

    expect(prisma.paymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.REVIEW,
        }),
      }),
    );

    expect(iyzico.retrieveCheckoutForm).not.toHaveBeenCalled();
    expect(iyzico.createCheckoutFormInitialize).not.toHaveBeenCalled();
  });

  it('keeps a potentially captured payment in REVIEW when amount differs', async () => {
    const attempt = {
      id: 'attempt-amount-test',
      orderId: 'order-amount-test',
      status: PaymentStatus.INITIATED,
      iyzicoPaymentId: null,
    };

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-amount-test',
          totalAmount: new Prisma.Decimal('100.00'),
          status: 'PENDING_PAYMENT',
        }),
      },
      paymentAttempt: {
        findFirst: jest.fn().mockResolvedValue(attempt),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };

    const service = new PaymentsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      (service as any).processSuccessfulPayment(
        attempt.id,
        attempt.orderId,
        'test-token',
        {
          status: 'success',
          paymentStatus: 'SUCCESS',
          paymentId: 'iyzico-payment-test',
          price: '90.00',
          fraudStatus: 1,
        },
        'product-test',
        'conversation-test',
      ),
    ).rejects.toThrow();

    expect(prisma.paymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.REVIEW,
        }),
      }),
    );
  });


  it('keeps an uncertain fraud status in REVIEW', async () => {
    const attempt = {
      id: 'attempt-fraud-test',
      orderId: 'order-fraud-test',
      status: PaymentStatus.INITIATED,
      iyzicoPaymentId: null,
    };

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-fraud-test',
          totalAmount: new Prisma.Decimal('100.00'),
          status: 'PENDING_PAYMENT',
        }),
      },
      paymentAttempt: {
        findFirst: jest.fn().mockResolvedValue(attempt),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };

    const service = new PaymentsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      (service as any).processSuccessfulPayment(
        attempt.id,
        attempt.orderId,
        'test-token',
        {
          status: 'success',
          paymentStatus: 'SUCCESS',
          paymentId: 'iyzico-fraud-test',
          price: '100.00',
          fraudStatus: undefined,
        },
        'product-test',
        'conversation-test',
      ),
    ).rejects.toThrow();

    expect(prisma.paymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.REVIEW,
        }),
      }),
    );
  });

});
