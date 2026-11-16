import { createHmac } from 'node:crypto';
import { IyzicoWebhookService } from './iyzico-webhook.service';

describe('IyzicoWebhookService security', () => {
  const secret = 'test-only-webhook-secret';
  const event = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: 'payment-123',
    token: 'token-123',
    paymentConversationId: 'conversation-123',
    status: 'SUCCESS',
  };

  const attempt = {
    id: 'attempt-123',
    orderId: 'order-123',
    provider: 'IYZICO',
    conversationId: 'conversation-123',
    checkoutToken: 'token-123',
    iyzicoPaymentId: 'payment-123',
  };

  let prisma: any;
  let eventStore: any;
  let service: IyzicoWebhookService;

  function sign(payload: typeof event, key = secret): string {
    const message =
      key +
      payload.iyziEventType +
      payload.iyziPaymentId +
      payload.token +
      payload.paymentConversationId +
      payload.status;

    return createHmac('sha256', key)
      .update(message, 'utf8')
      .digest('hex');
  }

  beforeEach(() => {
    process.env.IYZICO_SECRET_KEY = secret;

    prisma = {
      paymentAttempt: {
        findMany: jest.fn().mockResolvedValue([attempt]),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      order: {
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      ledgerEntry: {
        create: jest.fn(),
      },
      stockReservation: {
        update: jest.fn(),
      },
    };

    eventStore = {
      recordWithNotifications: jest.fn().mockResolvedValue({
        eventKey: 'test-event-key',
        created: true,
        status: 'INVESTIGATION_REQUIRED',
      }),
      record: jest.fn().mockResolvedValue({
        eventKey: 'test-event-key',
        created: true,
        status: 'RECEIVED',
      }),
    };

    service = new IyzicoWebhookService(prisma, eventStore);
  });

  afterEach(() => {
    delete process.env.IYZICO_SECRET_KEY;
  });

  it('matches a valid signed event without changing payments', async () => {
    const result = await service.inspect(event, sign(event));

    expect(result.status).toBe('MATCHED');
    expect(eventStore.record).toHaveBeenCalledWith(
      event,
      attempt.id,
      attempt.orderId,
      'RECEIVED',
    );
    expect(prisma.paymentAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider: 'IYZICO',
          conversationId: 'conversation-123',
        },
        take: 2,
      }),
    );
    expect(prisma.paymentAttempt.update).not.toHaveBeenCalled();
    expect(prisma.paymentAttempt.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(prisma.stockReservation.update).not.toHaveBeenCalled();
  });

  it('rejects invalid signature before database access', async () => {
    const result = await service.inspect(event, '0'.repeat(64));

    expect(result.status).toBe('REJECTED');
    expect(prisma.paymentAttempt.findMany).not.toHaveBeenCalled();
  });

  it('rejects unsupported event type before database access', async () => {
    const unsupported = {
      ...event,
      iyziEventType: 'OTHER_EVENT',
    };

    const result = await service.inspect(unsupported, sign(unsupported));

    expect(result.status).toBe('REJECTED');
    expect(prisma.paymentAttempt.findMany).not.toHaveBeenCalled();
  });

  it('rejects a different checkout token', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([
      { ...attempt, checkoutToken: 'different-token' },
    ]);

    expect((await service.inspect(event, sign(event))).status).toBe('REJECTED');
  });

  it('rejects a different payment ID', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([
      { ...attempt, iyzicoPaymentId: 'different-payment' },
    ]);

    expect((await service.inspect(event, sign(event))).status).toBe('REJECTED');
  });

  it('rejects duplicate conversation matches', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([
      attempt,
      { ...attempt, id: 'another-attempt', orderId: 'another-order' },
    ]);

    expect((await service.inspect(event, sign(event))).status).toBe('REJECTED');
  });

  it('requires investigation for missing stored token', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([
      { ...attempt, checkoutToken: null },
    ]);

    const result = await service.inspect(event, sign(event));

    expect(result.status).toBe('INVESTIGATION_REQUIRED');
    expect(eventStore.recordWithNotifications).toHaveBeenCalledWith(
      event,
      attempt.id,
      attempt.orderId,
    );
    expect(prisma.paymentAttempt.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('rejects when payment attempt is missing', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([]);

    expect((await service.inspect(event, sign(event))).status).toBe('REJECTED');
  });
});
