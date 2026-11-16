import { IyzicoWebhookEventStore } from './iyzico-webhook-event-store';

describe('Webhook concurrency behavior', () => {
  const event = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: 'isolated-payment',
    token: 'isolated-token',
    paymentConversationId: 'isolated-conversation',
    status: 'SUCCESS',
  };

  it('does not publish notifications on transaction conflict', async () => {
    const prisma: any = {
      $transaction: jest.fn().mockRejectedValue(
        Object.assign(new Error('Transaction conflict'), {
          code: 'P2034',
        }),
      ),
    };

    const notifier: any = {
      stage: jest.fn(),
      publish: jest.fn(),
    };

    const store = new IyzicoWebhookEventStore(prisma, notifier);

    await expect(
      store.recordWithNotifications(event, 'attempt-1', 'order-1'),
    ).rejects.toMatchObject({ code: 'P2034' });

    expect(notifier.publish).not.toHaveBeenCalled();
  });

  it('does not publish notifications on unique conflict', async () => {
    const prisma: any = {
      $transaction: jest.fn().mockRejectedValue(
        Object.assign(new Error('Unique conflict'), {
          code: 'P2002',
        }),
      ),
    };

    const notifier: any = {
      stage: jest.fn(),
      publish: jest.fn(),
    };

    const store = new IyzicoWebhookEventStore(prisma, notifier);

    await expect(
      store.recordWithNotifications(event, 'attempt-1', 'order-1'),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(notifier.publish).not.toHaveBeenCalled();
  });

  it('does not acknowledge a unique conflict without checking persistence', async () => {
    const prisma: any = {
      $transaction: jest.fn().mockRejectedValue(
        Object.assign(new Error('Unique conflict'), { code: 'P2002' }),
      ),
    };
    const notifier: any = {
      stage: jest.fn(),
      publish: jest.fn(),
    };
    const store = new IyzicoWebhookEventStore(prisma, notifier);

    await expect(
      store.recordWithNotifications(event, 'attempt-1', 'order-1'),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(notifier.publish).not.toHaveBeenCalled();
  });

  it('does not acknowledge a transaction conflict without checking persistence', async () => {
    const prisma: any = {
      $transaction: jest.fn().mockRejectedValue(
        Object.assign(new Error('Transaction conflict'), { code: 'P2034' }),
      ),
    };
    const notifier: any = {
      stage: jest.fn(),
      publish: jest.fn(),
    };
    const store = new IyzicoWebhookEventStore(prisma, notifier);

    await expect(
      store.recordWithNotifications(event, 'attempt-1', 'order-1'),
    ).rejects.toMatchObject({ code: 'P2034' });

    expect(notifier.publish).not.toHaveBeenCalled();
  });


  it('retries a transient P2034 conflict', async () => {
    const tx: any = {
      iyzicoWebhookEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'event-retry',
          status: 'INVESTIGATION_REQUIRED',
        }),
      },
    };
    const prisma: any = {
      $transaction: jest.fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('Conflict'), { code: 'P2034' }),
        )
        .mockImplementation(async (callback: any) => callback(tx)),
    };
    const notifier: any = {
      stage: jest.fn().mockResolvedValue([]),
      publish: jest.fn(),
    };

    const store = new IyzicoWebhookEventStore(prisma, notifier);
    const result = await store.recordWithNotifications(
      event, 'attempt-1', 'order-1',
    );

    expect(result.created).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(notifier.publish).toHaveBeenCalledTimes(1);
  });

  it('stops after three P2034 conflicts', async () => {
    const prisma: any = {
      $transaction: jest.fn().mockRejectedValue(
        Object.assign(new Error('Conflict'), { code: 'P2034' }),
      ),
    };
    const notifier: any = {
      stage: jest.fn(),
      publish: jest.fn(),
    };

    const store = new IyzicoWebhookEventStore(prisma, notifier);

    await expect(
      store.recordWithNotifications(event, 'attempt-1', 'order-1'),
    ).rejects.toMatchObject({ code: 'P2034' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(notifier.publish).not.toHaveBeenCalled();
  });

  it('does not retry P2002 conflicts', async () => {
    const prisma: any = {
      $transaction: jest.fn().mockRejectedValue(
        Object.assign(new Error('Unique conflict'), { code: 'P2002' }),
      ),
    };
    const notifier: any = {
      stage: jest.fn(),
      publish: jest.fn(),
    };

    const store = new IyzicoWebhookEventStore(prisma, notifier);

    await expect(
      store.recordWithNotifications(event, 'attempt-1', 'order-1'),
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(notifier.publish).not.toHaveBeenCalled();
  });


  it('discards staged notifications from a rolled-back attempt', async () => {
    const failedNotification: any = { id: 'rolled-back-notification' };
    const successfulNotification: any = { id: 'committed-notification' };

    const tx: any = {
      iyzicoWebhookEvent: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'event-staging',
          status: 'INVESTIGATION_REQUIRED',
        }),
      },
    };

    let transactionAttempt = 0;

    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => {
        transactionAttempt++;
        const result = await callback(tx);

        if (transactionAttempt === 1) {
          throw Object.assign(new Error('Rolled back'), { code: 'P2034' });
        }

        return result;
      }),
    };

    const notifier: any = {
      stage: jest.fn()
        .mockResolvedValueOnce([failedNotification])
        .mockResolvedValueOnce([successfulNotification]),
      publish: jest.fn(),
    };

    const store = new IyzicoWebhookEventStore(prisma, notifier);

    await store.recordWithNotifications(event, 'attempt-1', 'order-1');

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(notifier.stage).toHaveBeenCalledTimes(2);
    expect(notifier.publish).toHaveBeenCalledTimes(1);
    expect(notifier.publish).toHaveBeenCalledWith([
      successfulNotification,
    ]);
  });

});
