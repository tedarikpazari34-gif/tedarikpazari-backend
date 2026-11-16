import { IyzicoWebhookNotifier } from './iyzico-webhook-notifier.service';

describe('IyzicoWebhookNotifier security', () => {
  let notifier: IyzicoWebhookNotifier;
  let tx: any;
  let notifications: any;

  beforeEach(() => {
    notifications = {
      publishStoredNotification: jest.fn(),
    };

    notifier = new IyzicoWebhookNotifier(notifications);

    tx = {
      iyzicoWebhookEvent: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'event-1',
          status: 'INVESTIGATION_REQUIRED',
        }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-1' }]),
      },
      iyzicoWebhookNotification: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'link-1' }),
      },
      notification: {
        create: jest.fn().mockResolvedValue({
          id: 'notification-1',
          userId: 'admin-1',
          type: 'SYSTEM',
          title: 'iyzico webhook incelemesi',
          message: 'Bir ödeme bildirimi yönetici incelemesi gerektiriyor.',
          link: '/admin/finance',
          isRead: false,
          createdAt: new Date(),
        }),
      },
    };
  });

  it('selects admins using company role', async () => {
    await notifier.stage(tx, 'event-1');

    expect(tx.user.findMany).toHaveBeenCalledWith({
      where: { company: { role: 'ADMIN' } },
      select: { id: true },
    });
  });

  it('does not notify for a normal webhook', async () => {
    tx.iyzicoWebhookEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      status: 'RECEIVED',
    });

    expect(await notifier.stage(tx, 'event-1')).toEqual([]);
    expect(tx.user.findMany).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing admin notification', async () => {
    tx.iyzicoWebhookNotification.findUnique.mockResolvedValue({
      id: 'existing-link',
    });

    expect(await notifier.stage(tx, 'event-1')).toEqual([]);
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('creates an admin-only persistent notification link', async () => {
    const result = await notifier.stage(tx, 'event-1');

    expect(result).toHaveLength(1);
    expect(tx.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'admin-1',
        type: 'SYSTEM',
        link: '/admin/finance',
      }),
    });

    expect(tx.iyzicoWebhookNotification.create).toHaveBeenCalledWith({
      data: {
        webhookEventId: 'event-1',
        adminUserId: 'admin-1',
        notificationId: 'notification-1',
      },
    });

    expect(notifications.publishStoredNotification).not.toHaveBeenCalled();
  });

  it('publishes stored notifications after staging', () => {
    const record = {
      id: 'notification-1',
      userId: 'admin-1',
      type: 'SYSTEM' as const,
      title: 'Webhook incelemesi',
      message: 'Inceleme gerekli',
      link: '/admin/finance',
      isRead: false,
      createdAt: new Date(),
    };

    notifier.publish([record]);

    expect(notifications.publishStoredNotification)
      .toHaveBeenCalledWith(record);
  });

  it('preserves stored notifications if publishing throws', () => {
    notifications.publishStoredNotification.mockImplementation(() => {
      throw new Error('WebSocket unavailable');
    });

    expect(() => notifier.publish([{
      id: 'notification-1',
      userId: 'admin-1',
      type: 'SYSTEM',
      title: 'Webhook incelemesi',
      message: 'Inceleme gerekli',
      link: '/admin/finance',
      isRead: false,
      createdAt: new Date(),
    }])).not.toThrow();
  });
});
