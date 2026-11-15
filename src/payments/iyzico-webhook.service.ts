import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IyzicoWebhookEventStore } from './iyzico-webhook-event-store';
import {
  verifyIyzicoWebhookV3,
} from './iyzico-webhook-v3';
import {
  matchIyzicoWebhookPayment,
  WebhookMatchResult,
} from './iyzico-webhook-matching';

export type WebhookInspectionResult =
  | WebhookMatchResult
  | {
      status: 'REJECTED';
      reason: string;
    };

@Injectable()
export class IyzicoWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventStore: IyzicoWebhookEventStore,
  ) {}

  async inspect(
    payload: unknown,
    signatureHeader: unknown,
  ): Promise<WebhookInspectionResult> {
    const verified = verifyIyzicoWebhookV3(
      payload,
      signatureHeader,
      process.env.IYZICO_SECRET_KEY,
    );

    if (!verified) {
      return {
        status: 'REJECTED',
        reason: 'Webhook imzasi veya olay turu dogrulanamadi',
      };
    }

    // Yalnizca okuma: odeme, stok ve finans kaydi degistirilmez.
    // ConversationId birden fazla kayitla eslesirse reddedilir.
    const attempts = await this.prisma.paymentAttempt.findMany({
      where: {
        provider: PaymentProvider.IYZICO,
        conversationId: verified.paymentConversationId,
      },
      select: {
        id: true,
        orderId: true,
        provider: true,
        conversationId: true,
        checkoutToken: true,
        iyzicoPaymentId: true,
      },
      take: 2,
    });

    const result = matchIyzicoWebhookPayment(verified, attempts);

    if (result.status === 'REJECTED') {
      return result;
    }

    if (result.status === 'INVESTIGATION_REQUIRED') {
      await this.eventStore.recordWithNotifications(
        verified,
        result.paymentAttemptId,
        result.orderId,
      );
    } else {
      await this.eventStore.record(
        verified,
        result.paymentAttemptId,
        result.orderId,
        'RECEIVED',
      );
    }

    return result;
  }
}
