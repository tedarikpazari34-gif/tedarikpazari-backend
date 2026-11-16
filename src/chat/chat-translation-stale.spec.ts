import { ChatTranslationStoreService } from './chat-translation-store.service';

describe('Chat translation stale pending protection', () => {
  const message = {
    id: 'message-stale-1',
    content: 'Merhaba',
  };

  function setup(updatedAt: Date) {
    const tx = {
      chatTranslationQuota: {
        upsert: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      chatMessageTranslation: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'PENDING',
          translatedContent: null,
          updatedAt,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn(),
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
      prisma,
      tx,
    };
  }

  it('marks a pending translation older than 10 minutes as failed', async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000);
    const { service, tx } = setup(old);

    const result = await service.getOrReserve(message, 'en');

    expect(result.status).toBe('FAILED');
    expect(tx.chatMessageTranslation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING',
          updatedAt: { lt: expect.any(Date) },
        }),
        data: { status: 'FAILED' },
      }),
    );
    expect(tx.chatTranslationQuota.updateMany).not.toHaveBeenCalled();
    expect(tx.chatMessageTranslation.create).not.toHaveBeenCalled();
  });

  it('keeps recent pending translations without a second reservation', async () => {
    const { service, tx } = setup(new Date());

    const result = await service.getOrReserve(message, 'ru');

    expect(result.status).toBe('PENDING');
    expect(tx.chatMessageTranslation.updateMany).not.toHaveBeenCalled();
    expect(tx.chatTranslationQuota.updateMany).not.toHaveBeenCalled();
  });

  it('handles a concurrent unique-key conflict without retrying translation', async () => {
    const old = new Date(Date.now() - 11 * 60 * 1000);
    const { service, prisma } = setup(old);

    prisma.$transaction.mockRejectedValue(
      Object.assign(new Error('Unique conflict'), { code: 'P2002' }),
    );

    prisma.chatMessageTranslation.findUnique.mockResolvedValue({
      status: 'PENDING',
      translatedContent: null,
      updatedAt: old,
    });

    const result = await service.getOrReserve(message, 'de');

    expect(result.status).toBe('FAILED');
    expect(prisma.chatMessageTranslation.updateMany).toHaveBeenCalledTimes(1);
  });
});
