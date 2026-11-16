import { ChatService } from './chat.service';
import { ChatTranslationService } from './chat-translation.service';
import { hasForbiddenChatContactInfo } from './chat-contact-policy';

describe('Chat translation output safety', () => {
  const message = {
    id: 'm1',
    threadId: 't1',
    senderId: 'seller',
    content: 'Merhaba',
    isFlagged: false,
  };

  it('recognizes forbidden contact information', () => {
    expect(hasForbiddenChatContactInfo('contact@example.com')).toBe(true);
    expect(hasForbiddenChatContactInfo('https://example.com')).toBe(true);
    expect(hasForbiddenChatContactInfo('Merhaba')).toBe(false);
  });

  it('never returns an unsafe translation to the buyer', async () => {
    const service: any = Object.create(ChatService.prototype);

    service.canAccessThread = jest.fn().mockResolvedValue({});
    service.prisma = {
      chatMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findMany: jest.fn().mockResolvedValue([message]),
      },
    };

    service.injectedChatTranslation = {
      translateMessage: jest.fn().mockResolvedValue({
        translatedContent: 'contact@example.com',
        translationLanguage: 'en',
        translationStatus: 'CACHED',
      }),
    };

    const messages = await service.getMessages(
      { id: 'buyer' }, 't1', 'en',
    );

    expect(messages[0].content).toBe('Merhaba');
    expect(messages[0].translatedContent).toBeNull();
    expect(messages[0].translationStatus).toBe('SKIPPED');
  });

  it('does not store unsafe provider output', async () => {
    const store = {
      getOrReserve: jest.fn().mockResolvedValue({
        status: 'RESERVED',
        translatedContent: null,
      }),
      complete: jest.fn(),
      fail: jest.fn().mockResolvedValue(undefined),
    };

    const provider = {
      translate: jest.fn().mockResolvedValue('contact@example.com'),
    };

    const service = new ChatTranslationService(
      provider, 400000, store as any,
    );

    const result = await service.translateMessage(message, 'en');

    expect(result.translationStatus).toBe('SKIPPED');
    expect(result.translatedContent).toBeNull();
    expect(store.complete).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledTimes(1);
  });

  it('does not display unsafe cached translations', async () => {
    const store = {
      getOrReserve: jest.fn().mockResolvedValue({
        status: 'CACHED',
        translatedContent: 'https://example.com',
      }),
    };

    const provider = { translate: jest.fn() };

    const service = new ChatTranslationService(
      provider, 400000, store as any,
    );

    const result = await service.translateMessage(message, 'en');

    expect(result.translationStatus).toBe('SKIPPED');
    expect(result.translatedContent).toBeNull();
    expect(provider.translate).not.toHaveBeenCalled();
  });
});
