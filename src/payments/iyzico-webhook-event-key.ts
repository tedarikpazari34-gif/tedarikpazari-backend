import { createHash } from 'node:crypto';
import type { IyzicoWebhookV3Event } from './iyzico-webhook-v3';

/**
 * Deterministic identity for a verified iyzico Checkout Form event.
 *
 * IMPORTANT:
 * - Call only after Webhook V3 signature verification.
 * - This key is not an authentication mechanism.
 * - Same canonical event => same key.
 * - Different status => different key.
 * - Raw checkout token is never returned.
 */
export function createIyzicoWebhookEventKey(
  event: IyzicoWebhookV3Event,
): string {
  const canonical = JSON.stringify([
    'iyzico',
    'webhook-v3',
    event.iyziEventType,
    event.iyziPaymentId,
    event.token,
    event.paymentConversationId,
    event.status,
  ]);

  return createHash('sha256')
    .update(canonical, 'utf8')
    .digest('hex');
}
