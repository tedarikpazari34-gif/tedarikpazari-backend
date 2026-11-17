import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentProvider, PaymentStatus, Role } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('Buyer iyzico payment attempt status security', () => {
  let service: PaymentsService;
  let findFirst: jest.Mock;

  const buyer = { role: Role.BUYER, companyId: 'buyer-company' };

  const validAttempt = () => ({
    id: 'attempt-1',
    orderId: 'order-1',
    status: PaymentStatus.SUCCESS,
    callbackVerifiedAt: new Date(),
    iyzicoPaymentId: 'iyzico-payment-1',
    order: {
      status: OrderStatus.PAID,
      iyzicoPaymentId: 'iyzico-payment-1',
    },
  });

  beforeEach(() => {
    findFirst = jest.fn();
    service = Object.create(PaymentsService.prototype);
    Object.assign(service, {
      prisma: { paymentAttempt: { findFirst } },
    });
  });

  it.each([Role.SELLER, Role.ADMIN])(
    'rejects unauthorized role %s',
    async (role) => {
      await expect(
        service.getBuyerPaymentAttemptStatus(
          { role, companyId: 'other-company' },
          'attempt-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(findFirst).not.toHaveBeenCalled();
    },
  );

  it('rejects buyer without company identity', async () => {
    await expect(
      service.getBuyerPaymentAttemptStatus(
        { role: Role.BUYER },
        'attempt-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('restricts the lookup to the authenticated buyer company', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.getBuyerPaymentAttemptStatus(buyer, 'attempt-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'attempt-1',
          provider: PaymentProvider.IYZICO,
          order: { buyerId: 'buyer-company' },
        },
      }),
    );
  });

  it('returns only safe fields for verified successful payment', async () => {
    findFirst.mockResolvedValue(validAttempt());

    const result = await service.getBuyerPaymentAttemptStatus(
      buyer,
      'attempt-1',
    );

    expect(result).toEqual({
      paymentAttemptId: 'attempt-1',
      orderId: 'order-1',
      status: 'SUCCESS',
    });

    expect(JSON.stringify(result)).not.toContain('iyzico-payment-1');
  });

  it('does not confirm payment without callback verification', async () => {
    findFirst.mockResolvedValue({
      ...validAttempt(),
      callbackVerifiedAt: null,
    });

    const result = await service.getBuyerPaymentAttemptStatus(
      buyer,
      'attempt-1',
    );

    expect(result.status).toBe('REVIEW');
  });

  it('does not confirm mismatched provider payment identity', async () => {
    findFirst.mockResolvedValue({
      ...validAttempt(),
      iyzicoPaymentId: 'different-payment',
    });

    const result = await service.getBuyerPaymentAttemptStatus(
      buyer,
      'attempt-1',
    );

    expect(result.status).toBe('REVIEW');
  });

  it('does not confirm payment when order is still pending', async () => {
    findFirst.mockResolvedValue({
      ...validAttempt(),
      order: {
        ...validAttempt().order,
        status: OrderStatus.PENDING_PAYMENT,
      },
    });

    const result = await service.getBuyerPaymentAttemptStatus(
      buyer,
      'attempt-1',
    );

    expect(result.status).toBe('REVIEW');
  });

  it('returns FAILED for failed payment attempt', async () => {
    findFirst.mockResolvedValue({
      ...validAttempt(),
      status: PaymentStatus.FAILED,
    });

    const result = await service.getBuyerPaymentAttemptStatus(
      buyer,
      'attempt-1',
    );

    expect(result.status).toBe('FAILED');
  });

  it('returns PENDING for an initiated payment attempt', async () => {
    findFirst.mockResolvedValue({
      ...validAttempt(),
      status: PaymentStatus.INITIATED,
    });

    const result = await service.getBuyerPaymentAttemptStatus(
      buyer,
      'attempt-1',
    );

    expect(result.status).toBe('PENDING');
  });

  it('preserves REVIEW for an unresolved payment attempt', async () => {
    findFirst.mockResolvedValue({
      ...validAttempt(),
      status: PaymentStatus.REVIEW,
    });

    const result = await service.getBuyerPaymentAttemptStatus(
      buyer,
      'attempt-1',
    );

    expect(result.status).toBe('REVIEW');
  });
});
