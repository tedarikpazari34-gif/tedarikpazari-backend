import { IyzicoWebhookEventStore } from './iyzico-webhook-event-store';

describe('Webhook transaction security', () => {
  const event = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: 'payment-test',
    token: 'token-test',
    paymentConversationId: 'conversation-test',
    status: 'SUCCESS',
  };

  let prisma: any;
  let notifier: any;
  let tx: any;
  let store: IyzicoWebhookEventStore;

  beforeEach(() => {
    tx = {
      iyzicoWebhookEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'event-1',
          status: 'INVESTIGATION_REQUIRED',
        }),
        update: jest.fn(),
      },
    };

    prisma = {
      $transaction: jest.fn(async (fn) => fn(tx)),
      paymentAttempt: { update: jest.fn() },
      order: { update: jest.fn() },
      ledgerEntry: { create: jest.fn() },
      stockReservation: { update: jest.fn() },
    };

    notifier = {
      stage: jest.fn().mockResolvedValue([]),
      publish: jest.fn(),
    };

    store = new IyzicoWebhookEventStore(prisma, notifier);
  });

  it('stages notifications inside a transaction', async () => {
    const result = await store.recordWithNotifications(
      event, 'attempt-1', 'order-1',
    );

    expect(result.created).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(notifier.stage).toHaveBeenCalledWith(tx, 'event-1');
    expect(notifier.publish).toHaveBeenCalledWith([]);
  });

  it('does not publish if staging fails', async () => {
    notifier.stage.mockRejectedValue(new Error('stage failed'));

    await expect(
      store.recordWithNotifications(event, 'attempt-1', 'order-1'),
    ).rejects.toThrow('stage failed');

    expect(notifier.publish).not.toHaveBeenCalled();
  });

  it('does not change financial records', async () => {
    await store.recordWithNotifications(event, 'attempt-1', 'order-1');

    expect(prisma.paymentAttempt.update).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    expect(prisma.stockReservation.update).not.toHaveBeenCalled();
  });

  it('does not stage notifications for a processed event', async () => {
    tx.iyzicoWebhookEvent.createMany.mockResolvedValue({ count: 0 });
    tx.iyzicoWebhookEvent.update.mockResolvedValue({
      id: 'event-1',
      status: 'PROCESSED',
    });

    const result = await store.recordWithNotifications(
      event, 'attempt-1', 'order-1',
    );

    expect(result.created).toBe(false);
    expect(notifier.stage).not.toHaveBeenCalled();
  });
});
