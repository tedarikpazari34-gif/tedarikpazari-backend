import { InvoiceNotifier } from './invoice-notifier.service';

describe('Invoice notification routing', () => {
  const findMany = jest.fn();
  const create = jest.fn();
  const publishStoredNotification = jest.fn();

  const tx = {
    user: { findMany },
    notification: { create },
  };

  const notifier = new InvoiceNotifier({
    publishStoredNotification,
  } as any);

  const content = {
    title: 'Fatura',
    message: 'Fatura inceleme bildirimi',
    link: '/admin/finance',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([{ id: 'user1' }]);
    create.mockImplementation(async ({ data }) => ({
      id: 'notification1',
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link,
      isRead: false,
      createdAt: new Date(),
    }));
  });

  it('routes upload notices only to admins', async () => {
    const result = await notifier.stage(
      tx as any, 'ADMIN', null, content,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: { role: 'ADMIN' },
      select: { id: true },
    });

    expect(result).toHaveLength(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user1',
        type: 'SYSTEM',
        link: '/admin/finance',
      }),
    });
  });

  it('routes buyer notices to the exact buyer company', async () => {
    await notifier.stage(
      tx as any, 'BUYER', 'buyer1',
      { ...content, link: '/buyer/orders' },
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        role: 'BUYER',
        companyId: 'buyer1',
      },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        link: '/buyer/orders',
      }),
    });
  });

  it('routes rejection notices to the seller company', async () => {
    await notifier.stage(
      tx as any, 'SELLER', 'seller1',
      { ...content, link: '/seller/orders' },
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        role: 'SELLER',
        companyId: 'seller1',
      },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        link: '/seller/orders',
      }),
    });
  });

  it('rejects company notifications without a company', async () => {
    await expect(
      notifier.stage(tx as any, 'SELLER', null, content),
    ).rejects.toThrow();

    expect(findMany).not.toHaveBeenCalled();
  });

  it('persists a notification for each matching user', async () => {
    findMany.mockResolvedValue([
      { id: 'user1' },
      { id: 'user2' },
    ]);

    const result = await notifier.stage(
      tx as any, 'ADMIN', null, content,
    );

    expect(result).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('publishes stored notifications after commit', async () => {
    const result = await notifier.stage(
      tx as any, 'ADMIN', null, content,
    );

    expect(publishStoredNotification).not.toHaveBeenCalled();

    notifier.publish(result);

    expect(publishStoredNotification).toHaveBeenCalledTimes(1);
  });

  it('does not throw if real-time delivery fails', async () => {
    const result = await notifier.stage(
      tx as any, 'ADMIN', null, content,
    );

    publishStoredNotification.mockImplementation(() => {
      throw new Error('Temporary delivery failure');
    });

    expect(() => notifier.publish(result)).not.toThrow();
  });
});
