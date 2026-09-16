import 'dotenv/config';
import fs from 'node:fs/promises';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const localePath =
  '../../tedarikci-frontend/src/i18n/locales/ar.ts';

const source = await fs.readFile(localePath, 'utf8');

const jsSource = source.replace(
  /^\s*export\s+default\s+/,
  'globalThis.__locale = '
);

const dataUrl =
  'data:text/javascript;base64,' +
  Buffer.from(jsSource).toString('base64');

await import(dataUrl);

const locale = globalThis.__locale;

function flatten(obj, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, path, result);
    } else if (typeof value === 'string') {
      result[path] = value;
    }
  }

  return result;
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    current = current[parts[i]];
  }

  current[parts.at(-1)] = value;
}

function extractTokens(text) {
  const dynamicTokens =
    text.match(/\{\{[^}]+\}\}|https?:\/\/\S+|www\.\S+|%\d*/g) || [];

  return dynamicTokens;
}

const flattened = flatten(locale);
const allEntries = Object.entries(flattened);
const resumeFrom = 1400;
const entries = allEntries.slice(resumeFrom);
const batchSize = 40;

for (let i = 0; i < entries.length; i += batchSize) {
  const batchEntries = entries.slice(i, i + batchSize);
  const batch = Object.fromEntries(batchEntries);

  console.log(
    `Çevriliyor: ${i + 1}-${Math.min(i + batchSize, entries.length)} / ${entries.length}`
  );

  const response = await openai.responses.create({
    model: 'gpt-5-mini',
    input: [
      {
        role: 'system',
        content:
          `Sen Nex Tedarik Pazarı için profesyonel B2B arayüz çevirmenisin.
JSON değerlerini Almancadan doğal ve profesyonel Arapçaya çevir.
JSON anahtarlarını kesinlikle değiştirme.
"Nex Tedarik Pazarı" marka adını çevirme.
{{count}}, {{name}} gibi interpolation değişkenlerini aynen koru.
URL, e-posta, telefon, para birimi, yüzde, HTML parçaları ve teknik kısaltmaları koru.
MOQ, B2B, RFQ, VAT, API, URL gibi teknik ifadeleri gerektiğinde aynen bırak.
Sadece geçerli JSON döndür.`,
      },
      {
        role: 'user',
        content: JSON.stringify(batch, null, 2),
      },
    ],
  });

  const text = response.output_text?.trim();

  if (!text) {
    throw new Error(`AI yanıt vermedi. Batch başlangıcı: ${i}`);
  }

  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  const translated = JSON.parse(cleaned);

  for (const [key, original] of batchEntries) {
    if (!(key in translated)) {
      throw new Error(`Eksik anahtar: ${key}`);
    }

    const translatedValue = String(translated[key]);

    const originalTokens = extractTokens(original);
    const translatedTokens = extractTokens(translatedValue);

    for (const token of originalTokens) {
      if (!translatedTokens.includes(token)) {
        throw new Error(`Korunmayan token: ${key} -> ${token}`);
      }
    }

    setByPath(locale, key, translatedValue);
  }

  const output =
    'export default ' +
    JSON.stringify(locale, null, 2) +
    ';\n';

  await fs.writeFile(localePath, output, 'utf8');
}

console.log(`Tamamlandı: ${entries.length} metin Arapçaya çevrildi.`);
