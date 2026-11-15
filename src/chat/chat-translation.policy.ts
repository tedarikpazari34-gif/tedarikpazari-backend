import { BadRequestException } from '@nestjs/common';

export const CHAT_LANGUAGES = [
  'tr', 'en', 'ka', 'ru', 'de', 'ar', 'uz',
] as const;

export type ChatLanguage = (typeof CHAT_LANGUAGES)[number];

export function normalizeChatLanguage(value: unknown): ChatLanguage | null {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value !== 'string') {
    throw new BadRequestException('Geçersiz mesaj dili');
  }

  const language = value.trim().toLowerCase().split('-')[0];

  if (!CHAT_LANGUAGES.some((item) => item === language)) {
    throw new BadRequestException('Desteklenmeyen mesaj dili');
  }

  return language as ChatLanguage;
}
