import { BadRequestException, Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private readonly openai: OpenAI;

  private normalizeUnitType(value?: string): string {
    const unit = String(value || '')
      .trim()
      .toLocaleLowerCase('tr-TR');

    const aliases: Record<string, string> = {
      adet: 'adet',
      piece: 'adet',
      pieces: 'adet',
      unit: 'adet',
      units: 'adet',
      'stück': 'adet',
      штука: 'adet',
      قطعة: 'adet',
      dona: 'adet',
      'ცალი': 'adet',

      koli: 'koli',
      kutu: 'koli',
      box: 'koli',
      carton: 'koli',
      karton: 'koli',
      коробка: 'koli',
      كرتون: 'koli',
      'კოლოფი': 'koli',

      paket: 'paket',
      package: 'paket',
      pack: 'paket',
      packung: 'paket',
      упаковка: 'paket',
      عبوة: 'paket',
      qadoq: 'paket',
      'შეფუთვა': 'paket',

      kg: 'kg',
      kilogram: 'kg',
      kilogramm: 'kg',
      килограмм: 'kg',
      كيلوغرام: 'kg',
      'კილოგრამი': 'kg',

      ton: 'ton',
      tonne: 'ton',
      tonna: 'ton',
      тонна: 'ton',
      طن: 'ton',
      'ტონა': 'ton',

      litre: 'litre',
      liter: 'litre',
      litr: 'litre',
      литр: 'litre',
      لتر: 'litre',
      'ლიტრი': 'litre',

      metre: 'metre',
      meter: 'metre',
      metr: 'metre',
      метр: 'metre',
      متر: 'metre',
      'მეტრი': 'metre',

      palet: 'palet',
      pallet: 'palet',
      palette: 'palet',
      палета: 'palet',
      'منصة نقالة': 'palet',
      'პალეტი': 'palet',
    };

    return aliases[unit] || 'adet';
  }

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY tanımlı değil');
    }

    this.openai = new OpenAI({ apiKey });
  }

  async createQuoteDraft(input: {
    title?: string;
    quantity?: number | string;
    unitType?: string;
    note?: string;
  }) {
    const response = await this.openai.responses.create({
      model: 'gpt-5-mini',
      input: [
        {
          role: 'system',
          content:
            `Sen Tedarik Pazarı için B2B satıcı teklif asistanısın. Fiyat belirleme. Kullanıcının RFQ bilgilerine göre yalnızca gerçekçi bir teslim süresi öner ve kısa, profesyonel bir satıcı notu hazırla. Bilmediğin stok, marka, sertifika, ürün özelliği veya satıcının yapabileceği işlemleri uydurma. Stok mevcutmuş, sevkiyat kesinmiş, teslim tarihi garanti edilmiş veya herhangi bir özellik sağlanıyormuş gibi yazma. "Kesin teklif sunacağız", "stok mevcuttur", "şu tarihte teslim ederiz" gibi taahhüt ifadeleri kullanma. Teslim süresini yalnızca öneri olarak JSON içindeki deliveryDays alanında ver; sellerNote içinde kesin teslim süresi yazma. Eksik bilgi varsa nötr ve koşullu ifade kullan. Türkçe yaz. Satıcı notu en fazla 3-4 kısa cümle olsun.`,

        },
        {
          role: 'user',
          content: `RFQ bilgileri:

Başlık: ${input.title || ''}
Miktar: ${input.quantity || ''} ${input.unitType || ''}
Talep açıklaması:
${input.note || ''}

Sadece geçerli JSON döndür:
{
  "deliveryDays": 3,
  "sellerNote": "kısa profesyonel teklif notu"
}`,
        },
      ],
    });

    const text = response.output_text?.trim();

    if (!text) {
      throw new BadRequestException('AI yanıt üretemedi');
    }

    try {
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

      const parsed = JSON.parse(cleaned);

      let sellerNote = String(parsed.sellerNote || '');

      sellerNote = sellerNote
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          const text = sentence.toLocaleLowerCase('tr-TR');

          return !(
            text.includes('kesin') ||
            text.includes('stok') ||
            text.includes('sevkiyat') ||
            text.includes('teslim süresi') ||
            /\b\d+\s*(iş\s*)?gün\b/i.test(text)
          );
        })
        .join(' ')
        .replace(/\s{2,}/g, ' ')
        .trim();

      return {
        deliveryDays: Number(parsed.deliveryDays) || 3,
        sellerNote:
          sellerNote ||
          'Talebiniz için teşekkür ederiz. Ürün detaylarının netleşmesiyle birlikte uygun teklifimizi paylaşabiliriz.',
      };
    } catch {
      throw new BadRequestException('AI yanıtı işlenemedi');
    }
  }

  async createRfqDraft(prompt: string) {
    if (!prompt?.trim()) {
      throw new BadRequestException('Talep metni boş olamaz');
    }

    const response = await this.openai.responses.create({
      model: 'gpt-5-mini',
      input: [
        {
          role: 'system',
          content:
            'Sen Tedarik Pazarı için B2B satın alma talebi hazırlayan bir asistansın. Kullanıcının kısa ihtiyacını profesyonel ve kısa bir RFQ taslağına dönüştür. Türkçe yaz. Bilmediğin bilgileri uydurma. Açıklama en fazla 4-6 kısa satır olsun. Gereksiz teknik ayrıntı, sertifika, mevzuat, Incoterms veya ödeme şartı ekleme; kullanıcı özellikle belirtmediyse bunları isteme. Satıcının hızlı teklif verebilmesi için sadece ürün, miktar, temel özellikler, teslimat ve varsa özel tercihleri özetle. Kullanıcı miktarla birlikte bir birim açıkça yazdıysa (örneğin 100 koli, 20 paket, 5 ton, 50 litre, 3 palet), unitType alanında mutlaka kullanıcının yazdığı bu birimi kullan; Adet olarak değiştirme. Ayrıca ürünün ait olduğu en uygun ticari kategori adını categoryName alanında kısa ve genel bir ifade olarak öner. Örnek: çorap için Tekstil, ıslak mendil için Temizlik ve Hijyen, vida için Hırdavat veya Bağlantı Elemanları.',
        },
        {
          role: 'user',
          content: `Şu ihtiyacı yapılandırılmış bir satın alma talebine dönüştür:

${prompt}

Sadece geçerli JSON döndür:
{
  "title": "kısa talep başlığı",
  "quantity": 0,
  "unitType": "Adet",
  "deliveryCity": "",
  "targetPrice": "",
  "categoryName": "uygun kategori adı",
  "note": "satıcının teklif vermesi için profesyonel açıklama"
}`,
        },
      ],
    });

    const text = response.output_text?.trim();

    if (!text) {
      throw new BadRequestException('AI yanıt üretemedi');
    }

    try {
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

      return JSON.parse(cleaned);
    } catch {
      throw new BadRequestException('AI yanıtı işlenemedi');
    }
  }

  async createProductDraft(prompt: string, language?: string) {
    if (!prompt?.trim()) {
      throw new BadRequestException('Ürün bilgisi boş olamaz');
    }

    const normalizedLanguage = (language || 'tr').toLowerCase().split('-')[0];

    const languageMap: Record<string, string> = {
      tr: 'Türkçe',
      en: 'English',
      ka: 'ქართული',
      ru: 'Русский',
      de: 'Deutsch',
      ar: 'العربية',
      uz: 'O‘zbekcha',
    };

    const outputLanguage = languageMap[normalizedLanguage] || 'Türkçe';

    const response = await this.openai.responses.create({
      model: 'gpt-5-mini',
      input: [
        {
          role: 'system',
          content: `Sen Nex Tedarik Pazarı için B2B ürün listeleme asistanısın. Satıcının kısa ürün bilgisini profesyonel bir toptan satış ürün taslağına dönüştür. Yanıt içeriğini ${outputLanguage} dilinde yaz. Bilmediğin marka, stok miktarı, sertifika, teknik özellik, menşei veya fiyat bilgisini kesinlikle uydurma. Fiyat önerme. Ürün için kısa ve satışa uygun bir başlık, en uygun genel ticari kategori, satış birimi, makul minimum sipariş miktarı (MOQ), yalnızca öneri niteliğinde hazırlık/teslim süresi ve kısa ürün açıklaması oluştur. Açıklama en fazla 4-6 kısa cümle olsun. Kullanıcının verdiği bilgileri koru; vermediği özellikleri gerçekmiş gibi ekleme.`,
        },
        {
          role: 'user',
          content: `Şu ürünü Nex Tedarik Pazarı'nda satışa uygun şekilde yapılandır.

Yanıt dili: ${outputLanguage}

Ürün bilgisi:
${prompt}

ÖNEMLİ: unitType alanını yanıt diline çevirme.
unitType yalnızca şu standart kodlardan biri olmalıdır:
adet, koli, paket, kg, ton, litre, metre, palet

Sadece geçerli JSON döndür:
{
  "title": "kısa ürün adı",
  "categoryName": "uygun kategori adı",
  "unitType": "adet",
  "moq": 1,
  "leadTimeDays": 3,
  "description": "kısa profesyonel ürün açıklaması"
}`,
        },
      ],
    });

    const text = response.output_text?.trim();

    if (!text) {
      throw new BadRequestException('AI yanıt üretemedi');
    }

    try {
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

      const parsed = JSON.parse(cleaned);

      return {
        title: String(parsed.title || '').trim(),
        categoryName: String(parsed.categoryName || '').trim(),
        unitType: this.normalizeUnitType(parsed.unitType),
        moq: Math.max(1, Number(parsed.moq) || 1),
        leadTimeDays: Math.max(1, Number(parsed.leadTimeDays) || 3),
        description: String(parsed.description || '').trim(),
      };
    } catch {
      throw new BadRequestException('AI yanıtı işlenemedi');
    }
  }


  async translateProductContent(input: {
    sourceLanguage: string;
    targetLanguage: string;
    title: string;
    description?: string | null;
  }) {
    const response = await this.openai.responses.create({
      model: 'gpt-5-mini',
      input: [
        {
          role: 'system',
          content:
            'Sen Nex Tedarik Pazarı için profesyonel B2B katalog çevirmenisin. Sana verilen ürün başlığını ve açıklamasını yalnızca hedef dile çevir. Ürünün anlamını, miktarını, ölçüsünü, marka/model adını, teknik kodlarını ve ticari bilgilerini koru. Kullanıcının vermediği hiçbir özellik, sertifika, avantaj, menşei, stok bilgisi veya pazarlama iddiası ekleme. Marka, model, ürün kodu ve özel isimleri gereksiz yere çevirme. Çeviri doğal ve profesyonel olsun. Sadece geçerli JSON döndür.',
        },
        {
          role: 'user',
          content: `Kaynak dil: ${input.sourceLanguage}
Hedef dil: ${input.targetLanguage}

Ürün başlığı:
${input.title}

Ürün açıklaması:
${input.description || ''}

Sadece şu JSON biçiminde cevap ver:
{
  "title": "çevrilmiş ürün başlığı",
  "description": "çevrilmiş ürün açıklaması"
}`,
        },
      ],
    });

    const text = response.output_text?.trim();

    if (!text) {
      throw new BadRequestException('Ürün çevirisi üretilemedi');
    }

    try {
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

      const parsed = JSON.parse(cleaned);

      return {
        title: String(parsed.title || '').trim(),
        description: String(parsed.description || '').trim() || null,
      };
    } catch {
      throw new BadRequestException('Ürün çevirisi işlenemedi');
    }
  }

  async translateCategoryBatch(input: {
    sourceLanguage: string;
    targetLanguage: string;
    categories: Array<{ id: string; name: string }>;
  }) {
    if (!input.categories.length) {
      return [];
    }

    const response = await this.openai.responses.create({
      model: 'gpt-5-mini',
      input: [
        {
          role: 'system',
          content:
            'Sen Nex Tedarik Pazarı için profesyonel B2B kategori çevirmenisin. Verilen kategori listesindeki her kategori adını yalnızca hedef dile çevir. id değerlerini kesinlikle değiştirme. Kategori kapsamını genişletme veya daraltma, yeni özellik ekleme, marka veya özel isimleri gereksiz yere değiştirme. Girdi sırasını ve her id değerini koru. Sadece geçerli JSON döndür.',
        },
        {
          role: 'user',
          content: `Kaynak dil: ${input.sourceLanguage}
Hedef dil: ${input.targetLanguage}

Kategoriler:
${JSON.stringify(input.categories)}

Sadece şu biçimde geçerli JSON döndür:
{
  "categories": [
    { "id": "orijinal-id", "name": "çevrilmiş kategori adı" }
  ]
}`,
        },
      ],
    });

    const text = response.output_text?.trim();

    if (!text) {
      throw new BadRequestException('Kategori toplu çevirisi üretilemedi');
    }

    try {
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

      const parsed = JSON.parse(cleaned);
      const categories = Array.isArray(parsed.categories)
        ? parsed.categories
        : [];

      return categories
        .map((item: any) => ({
          id: String(item.id || '').trim(),
          name: String(item.name || '').trim(),
        }))
        .filter((item: { id: string; name: string }) => item.id && item.name);
    } catch {
      throw new BadRequestException('Kategori toplu çevirisi işlenemedi');
    }
  }

  async translateCategoryName(input: {
    sourceLanguage: string;
    targetLanguage: string;
    name: string;
  }) {
    const response = await this.openai.responses.create({
      model: 'gpt-5-mini',
      input: [
        {
          role: 'system',
          content:
            'Sen Nex Tedarik Pazarı için B2B kategori çevirmenisin. Verilen ticari kategori adını yalnızca hedef dile çevir. Anlamı koru, kategori kapsamını genişletme veya daraltma, yeni kelime ya da özellik uydurma. Marka veya özel isim varsa gereksiz yere değiştirme. Sadece geçerli JSON döndür.',
        },
        {
          role: 'user',
          content: `Kaynak dil: ${input.sourceLanguage}
Hedef dil: ${input.targetLanguage}

Kategori:
${input.name}

Sadece şu JSON biçiminde cevap ver:
{
  "name": "çevrilmiş kategori adı"
}`,
        },
      ],
    });

    const text = response.output_text?.trim();

    if (!text) {
      throw new BadRequestException('Kategori çevirisi üretilemedi');
    }

    try {
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '');

      const parsed = JSON.parse(cleaned);

      return {
        name: String(parsed.name || '').trim(),
      };
    } catch {
      throw new BadRequestException('Kategori çevirisi işlenemedi');
    }
  }

}
