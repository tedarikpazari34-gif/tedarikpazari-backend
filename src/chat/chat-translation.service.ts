import { createHash } from 'crypto';
import type { ChatLanguage } from './chat-translation.policy';
import { hasForbiddenChatContactInfo } from './chat-contact-policy';
import type { ChatTranslationStoreService } from './chat-translation-store.service';

export type TranslationStatus =
  | 'NOT_ENABLED'
  | 'TRANSLATED'
  | 'CACHED'
  | 'LIMIT_REACHED'
  | 'SKIPPED'
  | 'FAILED';

export type TranslationResult = {
  translatedContent: string | null;
  translationLanguage: ChatLanguage;
  translationStatus: TranslationStatus;
};

export type TranslationProvider = {
  translate(text: string, target: ChatLanguage): Promise<string>;
};

type MessageInput = {
  id: string;
  threadId: string;
  content: string;
  fileUrl?: string | null;
  fileName?: string | null;
};

export class ChatTranslationService {
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<TranslationResult>>();
  private month = new Date().toISOString().slice(0, 7);
  private usedCharacters = 0;

  // Gerçek sağlayıcı tanımlı değil: varsayılan olarak dış API çağrısı yok.
  constructor(
    private readonly provider: TranslationProvider | null = null,
    private readonly monthlyLimit = 400_000,
    private readonly store?: ChatTranslationStoreService,
  ) {}

  async translateMessage(
    message: MessageInput,
    language: ChatLanguage,
  ): Promise<TranslationResult> {
    const result = (
      status: TranslationStatus,
      translatedContent: string | null = null,
    ): TranslationResult => ({
      translatedContent,
      translationLanguage: language,
      translationStatus: status,
    });

    if (
      !message.content?.trim() ||
      message.fileUrl ||
      message.fileName ||
      message.content.length > 5000
    ) {
      return result('SKIPPED');
    }

    if (!this.provider) return result('NOT_ENABLED');

    // Kalıcı kota ve önbellek yalnızca sağlayıcı etkinse kullanılır.
    if (this.store) {
      let claim;
      try {
        claim = await this.store.getOrReserve(message, language);
      } catch {
        return result('FAILED');
      }

      if (claim.status === 'CACHED') {
        if (
          claim.translatedContent &&
          hasForbiddenChatContactInfo(claim.translatedContent)
        ) {
          return result('SKIPPED');
        }
        return result('CACHED', claim.translatedContent);
      }

      if (claim.status === 'LIMIT_REACHED') return result('LIMIT_REACHED');
      if (claim.status === 'SKIPPED') return result('SKIPPED');
      if (claim.status === 'FAILED') return result('FAILED');
      if (claim.status !== 'RESERVED') return result('SKIPPED');

      try {
        const translated = await this.provider.translate(
          message.content,
          language,
        );

        if (typeof translated !== 'string' || !translated.trim()) {
          throw new Error('Empty translation');
        }

        if (hasForbiddenChatContactInfo(translated)) {
          await this.store.fail(message, language);
          return result('SKIPPED');
        }

        const saved = await this.store.complete(
          message,
          language,
          translated,
        );

        return saved
          ? result('TRANSLATED', translated)
          : result('FAILED');
      } catch {
        try {
          await this.store.fail(message, language);
        } catch {
          // Orijinal mesaj gösterilir; kota otomatik iade edilmez.
        }
        return result('FAILED');
      }
    }


    const currentMonth = new Date().toISOString().slice(0, 7);
    if (currentMonth !== this.month) {
      this.month = currentMonth;
      this.usedCharacters = 0;
    }

    const hash = createHash('sha256')
      .update(message.content)
      .digest('hex');

    const key = [
      message.threadId,
      message.id,
      language,
      hash,
    ].join(':');

    const cached = this.cache.get(key);
    if (cached !== undefined) return result('CACHED', cached);

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const characters = message.content.length;

    if (this.usedCharacters + characters > this.monthlyLimit) {
      return result('LIMIT_REACHED');
    }

    this.usedCharacters += characters;
    const reservedMonth = this.month;

    const task: Promise<TranslationResult> = (async () => {
      try {
        const translated = await this.provider!.translate(
          message.content,
          language,
        );

        if (typeof translated !== 'string' || !translated.trim()) {
          throw new Error('Empty translation');
        }

        this.cache.set(key, translated);

        if (this.cache.size > 1000) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }

        return result('TRANSLATED', translated);
      } catch {
        if (this.month === reservedMonth) {
          this.usedCharacters = Math.max(
            0,
            this.usedCharacters - characters,
          );
        }
        return result('FAILED');
      }
    })();

    this.inFlight.set(key, task);

    try {
      return await task;
    } finally {
      this.inFlight.delete(key);
    }
  }
}
