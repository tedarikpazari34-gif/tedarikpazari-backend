import { ChatTranslationService } from './chat-translation.service';

const message = {
  id: 'message-1',
  threadId: 'thread-1',
  content: 'Merhaba',
};

describe('Chat translation service - offline safety', () => {
  it('does not call any provider by default', async () => {
    const service = new ChatTranslationService();
    expect(await service.translateMessage(message, 'en')).toMatchObject({
      translatedContent: null,
      translationStatus: 'NOT_ENABLED',
    });
  });

  it('translates with a mock and caches the result', async () => {
    const translate = jest.fn().mockResolvedValue('Hello');
    const service = new ChatTranslationService({ translate });

    const first = await service.translateMessage(message, 'en');
    const second = await service.translateMessage(message, 'en');

    expect(first.translationStatus).toBe('TRANSLATED');
    expect(first.translatedContent).toBe('Hello');
    expect(second.translationStatus).toBe('CACHED');
    expect(translate).toHaveBeenCalledTimes(1);
    expect(message.content).toBe('Merhaba');
  });

  it('blocks translation above the configured limit', async () => {
    const translate = jest.fn().mockResolvedValue('Hello');
    const service = new ChatTranslationService({ translate }, 5);

    const result = await service.translateMessage(message, 'en');

    expect(result.translationStatus).toBe('LIMIT_REACHED');
    expect(translate).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent translation requests', async () => {
    const translate = jest.fn().mockResolvedValue('Hello');
    const service = new ChatTranslationService({ translate });

    const results = await Promise.all([
      service.translateMessage(message, 'en'),
      service.translateMessage(message, 'en'),
    ]);

    expect(translate).toHaveBeenCalledTimes(1);
    expect(results[0].translatedContent).toBe('Hello');
    expect(results[1].translatedContent).toBe('Hello');
  });

  it('falls back to original content when provider fails', async () => {
    const translate = jest.fn().mockRejectedValue(new Error('Unavailable'));
    const service = new ChatTranslationService({ translate });

    const result = await service.translateMessage(message, 'ru');

    expect(result.translationStatus).toBe('FAILED');
    expect(result.translatedContent).toBeNull();
  });

  it('does not send attachments to the translator', async () => {
    const translate = jest.fn().mockResolvedValue('Hello');
    const service = new ChatTranslationService({ translate });

    const result = await service.translateMessage(
      { ...message, fileUrl: 'attachment-placeholder' },
      'en',
    );

    expect(result.translationStatus).toBe('SKIPPED');
    expect(translate).not.toHaveBeenCalled();
  });
});
