import { participantVisibleChatMessageWhere } from './chat-file-review-policy';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ChatService } from './chat.service';
import { normalizeChatLanguage } from './chat-translation.policy';

describe('Chat translation security', () => {
  const user = {
    id: 'user-1',
    role: Role.BUYER,
    companyId: 'buyer-1',
  };

  function setup() {
    const message = {
      id: 'message-1',
      threadId: 'thread-1',
      senderId: 'user-2',
      content: 'Merhaba',
      isFlagged: false,
    };

    const prisma = {
      chatThread: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'thread-1',
          buyerId: 'buyer-1',
          sellerId: 'seller-1',
          logisticsId: null,
        }),
      },
      chatMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([message]),
      },
    };

    const service = new ChatService(
      prisma as any,
      {} as any,
      {} as any,
    );

    return { prisma, service, message };
  }

  it('supports all seven languages', () => {
    for (const language of ['tr', 'en', 'ka', 'ru', 'de', 'ar', 'uz']) {
      expect(normalizeChatLanguage(language)).toBe(language);
    }
    expect(normalizeChatLanguage('ru-RU')).toBe('ru');
  });

  it('rejects unsupported or malformed languages', () => {
    expect(() => normalizeChatLanguage('xx')).toThrow(BadRequestException);
    expect(() => normalizeChatLanguage(['tr'])).toThrow(BadRequestException);
  });

  it('preserves original messages without language selection', async () => {
    const { service, message } = setup();
    const result = await service.getMessages(user, 'thread-1');

    expect(result).toEqual([message]);
  });

  it('returns disabled translation status without external calls', async () => {
    const { service, message, prisma } = setup();
    const result = await service.getMessages(user, 'thread-1', 'ru');

    expect(result[0]).toMatchObject({
      content: message.content,
      translatedContent: null,
      translationLanguage: 'ru',
      translationStatus: 'NOT_ENABLED',
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

  it('denies access before reading or translating messages', async () => {
    const { service, prisma } = setup();

    await expect(
      service.getMessages(
        { id: 'outsider', role: Role.BUYER, companyId: 'other-company' },
        'thread-1',
        'en',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.chatMessage.updateMany).not.toHaveBeenCalled();
    expect(prisma.chatMessage.findMany).not.toHaveBeenCalled();
  });
});
