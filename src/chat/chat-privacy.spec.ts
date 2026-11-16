import { participantVisibleChatMessageWhere } from './chat-file-review-policy';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ChatService } from './chat.service';

describe('Chat privacy', () => {
  const setup = () => {
    const prisma = {
      chatThread: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      chatMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: { findUnique: jest.fn() },
      rFQ: { findUnique: jest.fn() },
    };
    return {
      prisma,
      service: new ChatService(prisma as any, {} as any, {} as any),
    };
  };

  it.each([Role.BUYER, Role.SELLER])(
    '%s için özel firma ve engellenmiş mesaj bilgilerini sınırlar',
    async (role) => {
      const { prisma, service } = setup();
      await service.listMine({ role, companyId: 'company-1' });
      const query = prisma.chatThread.findMany.mock.calls[0][0];

      expect(query.include.buyer).toEqual({ select: { id: true } });
      expect(query.include.seller).toEqual({ select: { id: true } });
      expect(query.include.order).toEqual({ select: { id: true } });
      expect(query.include.rfq).toEqual({
        select: { id: true, product: { select: { title: true } } },
      });
      expect(query.include.messages.where).toEqual({ isFlagged: false,
      ...participantVisibleChatMessageWhere,
    });
    },
  );

  it('adminin yetkili inceleme erişimini korur', async () => {
    const { prisma, service } = setup();
    await service.listMine({ role: Role.ADMIN });
    const query = prisma.chatThread.findMany.mock.calls[0][0];
    expect(query.include.buyer).toEqual({ select: { id: true } });
    expect(query.include.seller).toEqual({ select: { id: true } });
  });

  it('sohbet geçmişinde engellenmiş mesajları göstermez', async () => {
    const { prisma, service } = setup();
    prisma.chatThread.findUnique.mockResolvedValue({
      id: 'thread-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      logisticsId: null,
    });

    await service.getMessages(
      { role: Role.BUYER, companyId: 'buyer-1', id: 'user-1' },
      'thread-1',
    );

    expect(prisma.chatThread.findUnique).toHaveBeenCalledWith({
      where: { id: 'thread-1' },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        logisticsId: true,
      },
    });
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          threadId: 'thread-1',
          isFlagged: false,
          ...participantVisibleChatMessageWhere,
        },
      }),
    );
  });

  it('yetkisiz şirketin mesajları okumasını engeller', async () => {
    const { prisma, service } = setup();
    prisma.chatThread.findUnique.mockResolvedValue({
      id: 'thread-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      logisticsId: null,
    });

    await expect(
      service.getMessages(
        { role: Role.SELLER, companyId: 'other', id: 'user-2' },
        'thread-1',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it('sipariş sohbetinde özel sipariş alanlarını döndürmez', async () => {
    const { prisma, service } = setup();
    prisma.order.findUnique.mockResolvedValue({
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
    });
    prisma.chatThread.findFirst.mockResolvedValue({ id: 'thread-1' });

    await service.createThreadForOrder(
      { role: Role.BUYER, companyId: 'buyer-1' },
      'order-1',
    );

    const query = prisma.chatThread.findFirst.mock.calls[0][0];
    expect(query.include.buyer).toEqual({ select: { id: true } });
    expect(query.include.seller).toEqual({ select: { id: true } });
    expect(query.include.order).toEqual({ select: { id: true } });
  });
});

describe('RFQ sohbet gizliliği', () => {
  it.each([true, false])(
    'mevcut sohbet=%s: yalnızca izinli bilgileri döndürür',
    async (existing) => {
      const prisma = {
        rFQ: {
          findUnique: jest.fn().mockResolvedValue({
            buyerId: 'buyer-1',
            product: { sellerId: 'seller-1' },
          }),
        },
        chatThread: {
          findFirst: jest.fn().mockResolvedValue(
            existing ? { id: 'thread-1' } : null,
          ),
          create: jest.fn().mockResolvedValue({ id: 'thread-1' }),
        },
      };

      const service = new ChatService(
        prisma as any,
        {} as any,
        {} as any,
      );

      await service.createThreadForRfq(
        { role: Role.BUYER, companyId: 'buyer-1' },
        'rfq-1',
      );

      const query = existing
        ? prisma.chatThread.findFirst.mock.calls[0][0]
        : prisma.chatThread.create.mock.calls[0][0];

      expect(query.include.buyer).toEqual({ select: { id: true } });
      expect(query.include.seller).toEqual({ select: { id: true } });
      expect(query.include.logistics).toEqual({ select: { id: true } });
      expect(query.include.shippingOrder).toEqual({
        select: { trackingNo: true },
      });
      expect(query.include.rfq).toEqual({
        select: {
          id: true,
          product: { select: { title: true } },
        },
      });
    },
  );
});

describe('Sohbet rol ve firma yetkilendirmesi', () => {
  const setup = () => {
    const prisma = {
      chatThread: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'thread-1',
          buyerId: 'buyer-1',
          sellerId: 'seller-1',
          logisticsId: 'logistics-1',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      chatMessage: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    return {
      prisma,
      service: new ChatService(prisma as any, {} as any, {} as any),
    };
  };

  it.each([
    [Role.BUYER, 'seller-1'],
    [Role.SELLER, 'buyer-1'],
    [Role.LOGISTICS, 'buyer-1'],
    [Role.BUYER, null],
    [Role.SELLER, null],
  ])('%s rolü, %s firmasıyla yetkisiz erişemez', async (role, companyId) => {
    const { prisma, service } = setup();

    await expect(
      service.getMessages({ role, companyId, id: 'user-1' }, 'thread-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it.each([
    [Role.BUYER, 'buyerId'],
    [Role.SELLER, 'sellerId'],
    [Role.LOGISTICS, 'logisticsId'],
  ])('%s yalnız kendi sohbetlerini listeler', async (role, field) => {
    const { prisma, service } = setup();
    await service.listMine({ role, companyId: 'company-1' });

    expect(prisma.chatThread.findMany.mock.calls[0][0].where).toEqual({
      [field]: 'company-1',
    });
  });

  it('firma kimliği olmayan kullanıcının liste erişimini reddeder', async () => {
    const { service } = setup();
    await expect(
      service.listMine({ role: Role.BUYER, companyId: null }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('Okunmamış mesaj gizliliği', () => {
  const setup = () => {
    const prisma = {
      chatMessage: { count: jest.fn().mockResolvedValue(3) },
    };
    return {
      prisma,
      service: new ChatService(prisma as any, {} as any, {} as any),
    };
  };

  it.each([
    [Role.BUYER, 'buyerId'],
    [Role.SELLER, 'sellerId'],
    [Role.LOGISTICS, 'logisticsId'],
  ])('%s yalnız kendi mesajlarını sayar', async (role, field) => {
    const { prisma, service } = setup();
    await service.getUnreadCount({
      id: 'user-1', role, companyId: 'company-1',
    });
    expect(prisma.chatMessage.count.mock.calls[0][0].where).toEqual({
      isRead: false,
      isFlagged: false,
      ...participantVisibleChatMessageWhere,
      senderId: { not: 'user-1' },
      thread: { [field]: 'company-1' },
    });
  });

  it('adminin yetkili sayımını korur', async () => {
    const { prisma, service } = setup();
    await service.getUnreadCount({ id: 'admin-1', role: Role.ADMIN });
    const where = prisma.chatMessage.count.mock.calls[0][0].where;
    expect(where.isFlagged).toBe(false);
    expect(where.thread).toBeUndefined();
  });

  it('firmasız kullanıcının sayımını reddeder', async () => {
    const { prisma, service } = setup();
    await expect(service.getUnreadCount({
      id: 'user-1', role: Role.BUYER, companyId: null,
    })).rejects.toThrow(ForbiddenException);
    expect(prisma.chatMessage.count).not.toHaveBeenCalled();
  });
});
