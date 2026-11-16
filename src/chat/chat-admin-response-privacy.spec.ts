import { participantVisibleChatMessageWhere } from './chat-file-review-policy';
import { Role } from '@prisma/client';
import { ChatService } from './chat.service';

describe('Chat admin response privacy', () => {
  let service: ChatService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      chatThread: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      chatMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new ChatService(
      prisma,
      {} as any,
      {} as any,
    );
  });

  it('admin sohbet listesinde şirketlerin özel alanlarını seçmez', async () => {
    await service.listMine({
      id: 'admin-1',
      role: Role.ADMIN,
      companyId: 'admin-company',
    });

    const query = prisma.chatThread.findMany.mock.calls[0][0];

    expect(query.include.buyer).toEqual({
      select: { id: true },
    });

    expect(query.include.seller).toEqual({
      select: { id: true },
    });

    expect(query.include.logistics).toEqual({
      select: { id: true },
    });

    expect(query.include.order).toEqual({
      select: { id: true },
    });

    expect(query.include.messages.where).toEqual({
      isFlagged: false,
      ...participantVisibleChatMessageWhere,
    });

    expect(JSON.stringify(query)).not.toMatch(
      /taxNumber|iyzicoIban|iyzicoIdentityNumber|password|paymentIdentityNumber|phoneVerificationCode/,
    );
  });

  it('moderasyon sorgusunda tam şirket kayıtlarını döndürmez', async () => {
    await service.listFlaggedMessages({
      id: 'admin-1',
      role: Role.ADMIN,
      companyId: 'admin-company',
    });

    const query = prisma.chatMessage.findMany.mock.calls[0][0];
    const thread = query.include.thread.include;

    expect(thread.buyer).toEqual({
      select: { id: true },
    });

    expect(thread.seller).toEqual({
      select: { id: true },
    });

    expect(thread.order).toEqual({
      select: { id: true },
    });

    expect(JSON.stringify(thread)).not.toMatch(
      /taxNumber|iyzicoIban|iyzicoIdentityNumber|password|paymentIdentityNumber/,
    );
  });

  it('satıcı admin moderasyon kayıtlarını okuyamaz', async () => {
    await expect(
      service.listFlaggedMessages({
        id: 'seller-1',
        role: Role.SELLER,
        companyId: 'seller-company',
      }),
    ).rejects.toThrow();

    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
  });
});
