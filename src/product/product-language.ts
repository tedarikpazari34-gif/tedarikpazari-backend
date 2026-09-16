export const SUPPORTED_PRODUCT_LANGUAGES = [
  'tr',
  'en',
  'ka',
  'ru',
  'de',
  'ar',
  'uz',
] as const;

export type ProductLanguage = (typeof SUPPORTED_PRODUCT_LANGUAGES)[number];

export function normalizeProductLanguage(
  value?: string | null,
): ProductLanguage {
  const normalized = (value || 'tr').toLowerCase().split('-')[0];

  return SUPPORTED_PRODUCT_LANGUAGES.includes(
    normalized as ProductLanguage,
  )
    ? (normalized as ProductLanguage)
    : 'tr';
}
