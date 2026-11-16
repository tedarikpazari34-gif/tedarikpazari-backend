import { createHmac } from 'node:crypto';
import { IyzicoWebhookService } from './iyzico-webhook.service';
import { IyzicoWebhookController } from './iyzico-webhook.controller';

describe('Iyzico webhook persistence security', () => {
  const secret = 'isolated-test-secret';
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
    conversationId: event.paymentConversationId,
    checkoutToken: event.token,
    iyzicoPaymentId: event.iyziPaymentId,
  };

  let prisma: any;
  let eventStore: any;
  let service: IyzicoWebhookService;

  const sign = () => {
    const message =
      secret +
      event.iyziEventType +
      event.iyziPaymentId +
      event.token +
      event.paymentConversationId +
      event.status;

    return createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest('hex');
  };

  beforeEach(() => {
    process.env.IYZICO_SECRET_KEY = secret;

    prisma = {
      paymentAttempt: {
        findMany: jest.fn().mockResolvedValue([attempt]),
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

  it('does not persist events with invalid signatures', async () => {
    const result = await service.inspect(event, '0'.repeat(64));

    expect(result.status).toBe('REJECTED');
    expect(prisma.paymentAttempt.findMany).not.toHaveBeenCalled();
    expect(eventStore.record).not.toHaveBeenCalled();
  });

  it('does not persist events with a mismatched token', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([
      { ...attempt, checkoutToken: 'different-token' },
    ]);

    const result = await service.inspect(event, sign());

    expect(result.status).toBe('REJECTED');
    expect(eventStore.record).not.toHaveBeenCalled();
  });

  it('does not persist ambiguous payment matches', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([
      attempt,
      { ...attempt, id: 'second-attempt' },
    ]);

    const result = await service.inspect(event, sign());

    expect(result.status).toBe('REJECTED');
    expect(eventStore.record).not.toHaveBeenCalled();
  });

  it('does not acknowledge persistence failures', async () => {
    eventStore.record.mockRejectedValue(new Error('DB write failed'));

    const controller = new IyzicoWebhookController(service);

    await expect(
      controller.receive(event, {
        headers: { 'x-iyz-signature-v3': sign() },
      } as any),
    ).rejects.toThrow('DB write failed');

    expect(eventStore.record).toHaveBeenCalledTimes(1);
  });

  it('persists investigation events without approving payment', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([
      { ...attempt, checkoutToken: null },
    ]);

    const result = await service.inspect(event, sign());

    expect(result.status).toBe('INVESTIGATION_REQUIRED');
    expect(eventStore.recordWithNotifications).toHaveBeenCalledWith(
      event,
      attempt.id,
      attempt.orderId,
    );
  });
});
