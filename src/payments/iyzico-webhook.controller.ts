import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { IyzicoWebhookService } from './iyzico-webhook.service';

@Controller('payments/iyzico')
export class IyzicoWebhookController {
  constructor(
    private readonly webhook: IyzicoWebhookService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() payload: unknown,
    @Req() req: Request,
  ): Promise<{ received: boolean }> {
    const signature = req.headers['x-iyz-signature-v3'];

    const result = await this.webhook.inspect(
      payload,
      signature,
    );

    if (result.status === 'REJECTED') {
      throw new HttpException(
        'Webhook dogrulanamadi',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // MATCHED veya INVESTIGATION_REQUIRED:
    // Servis, yanit donmeden once dogrulanmis olayi kalici olarak kaydeder.
    // HTTP 200 odeme onayi anlamina gelmez.

    // Bu controller yalnizca bildirim inceleme modundadir.
    // PAID, stok, escrow veya komisyon degisikligi yapmaz.
    return { received: true };
  }
}
