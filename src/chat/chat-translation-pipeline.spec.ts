import { ChatTranslationService } from './chat-translation.service';

describe('Chat translation persistent pipeline', () => {
  const message = {
    id: 'message-1',
    threadId: 'thread-1',
    content: 'Merhaba',
  };

  function setup(status = 'RESERVED') {
    const store = {
      getOrReserve: jest.fn().mockResolvedValue({
        status,
        translatedContent: status === 'CACHED' ? 'Hello' : null,
      }),
      complete: jest.fn().mockResolvedValue(true),
      fail: jest.fn().mockResolvedValue(undefined),
    };

    const provider = {
      translate: jest.fn().mockResolvedValue('Hello'),
    };

    return { store, provider };
  }

  it('keeps provider disabled without database access', async () => {
    const { store } = setup();
    const service = new ChatTranslationService(null, 400000, store as any);

    const result = await service.translateMessage(message, 'en');

    expect(result.translationStatus).toBe('NOT_ENABLED');
    expect(store.getOrReserve).not.toHaveBeenCalled();
  });

  it('uses persistent cache without a provider call', async () => {
    const { store, provider } = setup('CACHED');
    const service = new ChatTranslationService(
      provider, 400000, store as any,
    );

    const result = await service.translateMessage(message, 'en');

    expect(result.translationStatus).toBe('CACHED');
    expect(result.translatedContent).toBe('Hello');
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('reserves quota and stores a mock translation', async () => {
    const { store, provider } = setup();
    const service = new ChatTranslationService(
      provider, 400000, store as any,
    );

    const result = await service.translateMessage(message, 'en');

    expect(result.translationStatus).toBe('TRANSLATED');
    expect(provider.translate).toHaveBeenCalledWith('Merhaba', 'en');
    expect(store.complete).toHaveBeenCalledTimes(1);
  });

  it('blocks provider calls after quota limit', async () => {
    const { store, provider } = setup('LIMIT_REACHED');
    const service = new ChatTranslationService(
      provider, 400000, store as any,
    );

    const result = await service.translateMessage(message, 'ru');

    expect(result.translationStatus).toBe('LIMIT_REACHED');
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing pending request', async () => {
    const { store, provider } = setup('PENDING');
    const service = new ChatTranslationService(
      provider, 400000, store as any,
    );

    const result = await service.translateMessage(message, 'de');

    expect(result.translationStatus).toBe('SKIPPED');
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('preserves original message when mock provider fails', async () => {
    const { store, provider } = setup();
    provider.translate.mockRejectedValue(new Error('Unavailable'));

    const service = new ChatTranslationService(
      provider, 400000, store as any,
    );

    const result = await service.translateMessage(message, 'ka');

    expect(result.translationStatus).toBe('FAILED');
    expect(result.translatedContent).toBeNull();
    expect(store.fail).toHaveBeenCalledTimes(1);
  });
});
