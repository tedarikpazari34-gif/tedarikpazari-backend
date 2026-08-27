import { BadRequestException, Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private readonly openai: OpenAI;

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
}
