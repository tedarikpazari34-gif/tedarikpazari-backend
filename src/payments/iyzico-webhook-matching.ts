import type { IyzicoWebhookV3Event } from './iyzico-webhook-v3';

export interface WebhookPaymentAttempt {
  id: string;
  orderId: string;
  provider: string;
  conversationId: string | null;
  checkoutToken: string | null;
  iyzicoPaymentId: string | null;
}

export type WebhookMatchResult =
  | {
      status: 'MATCHED';
      paymentAttemptId: string;
      orderId: string;
    }
  | {
      status: 'INVESTIGATION_REQUIRED';
      paymentAttemptId: string;
      orderId: string;
      reason: string;
    }
  | {
      status: 'REJECTED';
      reason: string;
    };

export function matchIyzicoWebhookPayment(
  event: IyzicoWebhookV3Event,
  attempts: readonly WebhookPaymentAttempt[],
): WebhookMatchResult {
  if (attempts.length !== 1) {
    return {
      status: 'REJECTED',
      reason:
        attempts.length === 0
          ? 'Odeme denemesi bulunamadi'
          : 'Birden fazla odeme denemesi bulundu',
    };
  }

  const attempt = attempts[0];

  if (
    attempt.provider !== 'IYZICO' ||
    !attempt.id ||
    !attempt.orderId ||
    !attempt.conversationId ||
    attempt.conversationId !== event.paymentConversationId
  ) {
    return {
      status: 'REJECTED',
      reason: 'Odeme denemesi ve conversationId dogrulanamadi',
    };
  }

  if (
    attempt.checkoutToken &&
    attempt.checkoutToken !== event.token
  ) {
    return {
      status: 'REJECTED',
      reason: 'Checkout token eslesmiyor',
    };
  }

  if (
    attempt.iyzicoPaymentId &&
    attempt.iyzicoPaymentId !== event.iyziPaymentId
  ) {
    return {
      status: 'REJECTED',
      reason: 'iyzico odeme kimligi eslesmiyor',
    };
  }

  if (!attempt.checkoutToken) {
    return {
      status: 'INVESTIGATION_REQUIRED',
      paymentAttemptId: attempt.id,
      orderId: attempt.orderId,
      reason:
        'Kayitli checkout token bulunmuyor; otomatik odeme onayi yasak',
    };
  }

  return {
    status: 'MATCHED',
    paymentAttemptId: attempt.id,
    orderId: attempt.orderId,
  };
}
