import { Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';
import { IyzicoWebhookNotifier } from './iyzico-webhook-notifier.service';
import { PrismaService } from '../prisma/prisma.service';
import type { IyzicoWebhookV3Event } from './iyzico-webhook-v3';
import { createIyzicoWebhookEventKey } from './iyzico-webhook-event-key';

export interface WebhookEventStoreResult {
  eventKey: string;
  created: boolean;
  status: string;
}

@Injectable()
export class IyzicoWebhookEventStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: IyzicoWebhookNotifier,
  ) {}

  /**
   * Call only after signature verification and payment matching.
   * This method stores delivery metadata only.
   * It must never confirm a payment or release stock.
   */
  async record(
    event: IyzicoWebhookV3Event,
    paymentAttemptId: string,
    orderId: string,
    status: 'RECEIVED' | 'INVESTIGATION_REQUIRED',
  ): Promise<WebhookEventStoreResult> {
    if (!paymentAttemptId || !orderId) {
      throw new Error('Webhook odeme referanslari eksik');
    }

    const eventKey = createIyzicoWebhookEventKey(event);

    const inserted = await this.prisma.iyzicoWebhookEvent.createMany({
      data: [{
        eventKey,
        paymentAttemptId,
        orderId,
        paymentId: event.iyziPaymentId,
        conversationId: event.paymentConversationId,
        eventType: event.iyziEventType,
        paymentStatus: event.status,
        status,
      }],
      skipDuplicates: true,
    });

    if (inserted.count === 1) {
      return {
        eventKey,
        created: true,
        status,
      };
    }

    const updated = await this.prisma.iyzicoWebhookEvent.update({
      where: { eventKey },
      data: {
        deliveryCount: { increment: 1 },
        lastReceivedAt: new Date(),
      },
      select: {
        status: true,
      },
    });

    return {
      eventKey,
      created: false,
      status: updated.status,
    };
  }

  /**
   * Şüpheli webhook olayını ve yönetici bildirimlerini
   * tek transaction içinde kaydeder.
   * Ödeme, sipariş, stok veya finans durumu değiştirilmez.
   */
  async recordWithNotifications(
    event: IyzicoWebhookV3Event,
    paymentAttemptId: string,
    orderId: string,
  ): Promise<WebhookEventStoreResult> {
    if (!paymentAttemptId || !orderId) {
      throw new Error('Webhook odeme referanslari eksik');
    }

    const eventKey = createIyzicoWebhookEventKey(event);
    let staged: Notification[] = [];
    let result: WebhookEventStoreResult | undefined;

    for (let attempt = 0; attempt < 3; attempt++) {
      const attemptStaged: Notification[] = [];

      try {
        result = await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.iyzicoWebhookEvent.createMany({
        data: [{
          eventKey,
          paymentAttemptId,
          orderId,
          paymentId: event.iyziPaymentId,
          conversationId: event.paymentConversationId,
          eventType: event.iyziEventType,
          paymentStatus: event.status,
          status: 'INVESTIGATION_REQUIRED',
        }],
        skipDuplicates: true,
      });

      const stored = inserted.count === 1
        ? await tx.iyzicoWebhookEvent.findUniqueOrThrow({
            where: { eventKey },
            select: { id: true, status: true },
          })
        : await tx.iyzicoWebhookEvent.update({
            where: { eventKey },
            data: {
              deliveryCount: { increment: 1 },
              lastReceivedAt: new Date(),
            },
            select: { id: true, status: true },
          });

      if (stored.status === 'INVESTIGATION_REQUIRED') {
        attemptStaged.push(...await this.notifier.stage(tx, stored.id));
      }

      return {
        eventKey,
        created: inserted.count === 1,
        status: stored.status,
      };
        });

        staged = attemptStaged;
        break;
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;

        if (code !== 'P2034' || attempt === 2) {
          throw error;
        }
      }
    }

    if (!result) {
      throw new Error('Webhook transaction sonucu alinamadi');
    }

    this.notifier.publish(staged);
    return result;
  }

}
