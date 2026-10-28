import { PaymentStatus, Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('iyzico charged amount and currency safety', () => {
  it.each([
    ['different paidPrice', { paidPrice: '101.00' }],
    ['missing paidPrice', { paidPrice: undefined }],
    ['different currency', { currency: 'USD' }],
    ['unexpected installment', { installment: 3 }],
    ['missing installment', { installment: undefined }],
  ])('requires REVIEW for %s', async (_name, override) => {
    const attempt = {
      id: 'attempt-amount',
      orderId: 'order-amount',
      status: PaymentStatus.INITIATED,
      iyzicoPaymentId: null,
    };

    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'order-amount',
          totalAmount: new Prisma.Decimal('100.00'),
          status: 'PENDING_PAYMENT',
        }),
      },
      paymentAttempt: {
        findFirst: jest.fn().mockResolvedValue(attempt),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (callback: any) =>
        callback({
          paymentAttempt: {
            updateMany: prisma.paymentAttempt.updateMany,
          },
        }),
      ),
    };

    const service = new PaymentsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const response = {
      status: 'success',
      paymentStatus: 'SUCCESS',
      paymentId: 'iyzico-amount-payment',
      price: '100.00',
      paidPrice: '100.00',
      currency: 'TRY',
      installment: 1,
      fraudStatus: 1,
      ...override,
    };

    await expect(
      (service as any).processSuccessfulPayment(
        attempt.id,
        attempt.orderId,
        'checkout-token',
        response,
        'product-amount',
        'conversation-amount',
      ),
    ).rejects.toThrow('mutabakat gerekli');

    expect(prisma.paymentAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentStatus.REVIEW,
        }),
      }),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
