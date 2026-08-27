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
            'Sen Tedarik Pazarı için B2B satın alma talebi hazırlayan bir asistansın. Kullanıcının kısa ihtiyacını profesyonel bir RFQ taslağına dönüştür. Türkçe yaz. Bilmediğin bilgileri uydurma.',
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
