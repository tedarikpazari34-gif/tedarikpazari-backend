import { ChatTranslationStoreService } from './chat-translation-store.service';

describe('Chat translation persistent quota', () => {
  const message = {
    id: 'message-1',
    content: 'Merhaba',
    isFlagged: false,
  };

  function setup() {
    const tx = {
      chatTranslationQuota: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatMessageTranslation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      chatMessageTranslation: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    return {
      service: new ChatTranslationStoreService(prisma as any),
      tx,
      prisma,
    };
  }

  it('reserves monthly quota before creating translation', async () => {
    const { service, tx } = setup();

    const result = await service.getOrReserve(message, 'en');

    expect(result.status).toBe('RESERVED');
    expect(tx.chatTranslationQuota.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usedCharacters: { lte: 399_993 },
        }),
        data: {
          usedCharacters: { increment: 7 },
        },
      }),
    );
    expect(tx.chatMessageTranslation.create).toHaveBeenCalledTimes(1);
  });

  it('uses cached translation without consuming quota', async () => {
    const { service, tx } = setup();

    tx.chatMessageTranslation.findUnique.mockResolvedValue({
      status: 'TRANSLATED',
      translatedContent: 'Hello',
    });

    const result = await service.getOrReserve(message, 'en');

    expect(result).toEqual({
      status: 'CACHED',
      translatedContent: 'Hello',
    });
    expect(tx.chatTranslationQuota.updateMany).not.toHaveBeenCalled();
  });

  it('blocks requests when monthly quota is exhausted', async () => {
    const { service, tx } = setup();

    tx.chatTranslationQuota.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.getOrReserve(message, 'ru');

    expect(result.status).toBe('LIMIT_REACHED');
    expect(tx.chatMessageTranslation.create).not.toHaveBeenCalled();
  });

  it('does not reserve flagged messages or attachments', async () => {
    const { service, prisma } = setup();

    expect(
      (await service.getOrReserve(
        { ...message, isFlagged: true },
        'en',
      )).status,
    ).toBe('SKIPPED');

    expect(
      (await service.getOrReserve(
        { ...message, fileUrl: 'attachment' },
        'en',
      )).status,
    ).toBe('SKIPPED');

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('stores completed translations', async () => {
    const { service, prisma } = setup();

    expect(await service.complete(message, 'en', 'Hello')).toBe(true);

    expect(prisma.chatMessageTranslation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'TRANSLATED',
          translatedContent: 'Hello',
        },
      }),
    );
  });
});
