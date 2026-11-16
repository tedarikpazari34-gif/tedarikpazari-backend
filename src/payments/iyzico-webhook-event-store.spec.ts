import { IyzicoWebhookEventStore } from './iyzico-webhook-event-store';

describe('IyzicoWebhookEventStore', () => {
  const event = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: 'payment-123',
    token: 'test-token',
    paymentConversationId: 'conversation-123',
    status: 'SUCCESS',
  };

  let prisma: any;
  let store: IyzicoWebhookEventStore;

  beforeEach(() => {
    prisma = {
      iyzicoWebhookEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ status: 'RECEIVED' }),
      },
    };

    store = new IyzicoWebhookEventStore(prisma, {
      stage: jest.fn().mockResolvedValue([]),
      publish: jest.fn(),
    } as any);
  });

  it('creates a new webhook event', async () => {
    const result = await store.record(
      event, 'attempt-123', 'order-123', 'RECEIVED',
    );

    expect(result.created).toBe(true);
    expect(result.status).toBe('RECEIVED');

    expect(prisma.iyzicoWebhookEvent.createMany)
      .toHaveBeenCalledWith(expect.objectContaining({
        skipDuplicates: true,
      }));

    expect(prisma.iyzicoWebhookEvent.update).not.toHaveBeenCalled();
  });

  it('increments delivery count for duplicate events', async () => {
    prisma.iyzicoWebhookEvent.createMany.mockResolvedValue({ count: 0 });

    const result = await store.record(
      event, 'attempt-123', 'order-123', 'RECEIVED',
    );

    expect(result.created).toBe(false);

    expect(prisma.iyzicoWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deliveryCount: { increment: 1 },
        }),
      }),
    );
  });

  it('preserves PROCESSED status on duplicate delivery', async () => {
    prisma.iyzicoWebhookEvent.createMany.mockResolvedValue({ count: 0 });
    prisma.iyzicoWebhookEvent.update.mockResolvedValue({
      status: 'PROCESSED',
    });

    const result = await store.record(
      event, 'attempt-123', 'order-123', 'RECEIVED',
    );

    expect(result.status).toBe('PROCESSED');
    expect(result.created).toBe(false);
  });

  it('preserves INVESTIGATION_REQUIRED status', async () => {
    prisma.iyzicoWebhookEvent.createMany.mockResolvedValue({ count: 0 });
    prisma.iyzicoWebhookEvent.update.mockResolvedValue({
      status: 'INVESTIGATION_REQUIRED',
    });

    const result = await store.record(
      event, 'attempt-123', 'order-123', 'RECEIVED',
    );

    expect(result.status).toBe('INVESTIGATION_REQUIRED');
  });

  it('rejects missing payment attempt ID', async () => {
    await expect(
      store.record(event, '', 'order-123', 'RECEIVED'),
    ).rejects.toThrow();

    expect(prisma.iyzicoWebhookEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects missing order ID', async () => {
    await expect(
      store.record(event, 'attempt-123', '', 'RECEIVED'),
    ).rejects.toThrow();

    expect(prisma.iyzicoWebhookEvent.createMany).not.toHaveBeenCalled();
  });

  it('does not hide database errors', async () => {
    prisma.iyzicoWebhookEvent.createMany.mockRejectedValue(
      new Error('Database unavailable'),
    );

    await expect(
      store.record(event, 'attempt-123', 'order-123', 'RECEIVED'),
    ).rejects.toThrow('Database unavailable');
  });

  it('does not store raw checkout tokens', async () => {
    await store.record(
      event, 'attempt-123', 'order-123', 'RECEIVED',
    );

    const argumentsPassed =
      prisma.iyzicoWebhookEvent.createMany.mock.calls[0][0];

    expect(JSON.stringify(argumentsPassed)).not.toContain(event.token);
  });
});
