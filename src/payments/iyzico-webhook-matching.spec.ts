import {
  matchIyzicoWebhookPayment,
  WebhookPaymentAttempt,
} from './iyzico-webhook-matching';
import type { IyzicoWebhookV3Event } from './iyzico-webhook-v3';

describe('iyzico webhook payment matching', () => {
  const event: IyzicoWebhookV3Event = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: 'payment-123',
    token: 'token-123',
    paymentConversationId: 'conversation-123',
    status: 'SUCCESS',
  };

  const attempt: WebhookPaymentAttempt = {
    id: 'attempt-123',
    orderId: 'order-123',
    provider: 'IYZICO',
    conversationId: 'conversation-123',
    checkoutToken: 'token-123',
    iyzicoPaymentId: 'payment-123',
  };

  it('matches a valid payment attempt', () => {
    expect(matchIyzicoWebhookPayment(event, [attempt])).toEqual({
      status: 'MATCHED',
      paymentAttemptId: 'attempt-123',
      orderId: 'order-123',
    });
  });

  it('rejects missing attempts', () => {
    expect(matchIyzicoWebhookPayment(event, []).status).toBe('REJECTED');
  });

  it('rejects duplicate conversation matches', () => {
    expect(
      matchIyzicoWebhookPayment(event, [
        attempt,
        { ...attempt, id: 'attempt-456', orderId: 'order-456' },
      ]).status,
    ).toBe('REJECTED');
  });

  it('rejects another payment provider', () => {
    expect(
      matchIyzicoWebhookPayment(event, [
        { ...attempt, provider: 'OTHER' },
      ]).status,
    ).toBe('REJECTED');
  });

  it('rejects different conversation IDs', () => {
    expect(
      matchIyzicoWebhookPayment(event, [
        { ...attempt, conversationId: 'another-conversation' },
      ]).status,
    ).toBe('REJECTED');
  });

  it('rejects different checkout tokens', () => {
    expect(
      matchIyzicoWebhookPayment(event, [
        { ...attempt, checkoutToken: 'another-token' },
      ]).status,
    ).toBe('REJECTED');
  });

  it('rejects different iyzico payment IDs', () => {
    expect(
      matchIyzicoWebhookPayment(event, [
        { ...attempt, iyzicoPaymentId: 'another-payment' },
      ]).status,
    ).toBe('REJECTED');
  });

  it('requires investigation when stored token is missing', () => {
    expect(
      matchIyzicoWebhookPayment(event, [
        { ...attempt, checkoutToken: null },
      ]),
    ).toEqual({
      status: 'INVESTIGATION_REQUIRED',
      paymentAttemptId: 'attempt-123',
      orderId: 'order-123',
      reason:
        'Kayitli checkout token bulunmuyor; otomatik odeme onayi yasak',
    });
  });

  it('does not treat a missing stored payment ID as payment approval', () => {
    expect(
      matchIyzicoWebhookPayment(event, [
        { ...attempt, iyzicoPaymentId: null },
      ]).status,
    ).toBe('MATCHED');
  });

  it('rejects missing order identity', () => {
    expect(
      matchIyzicoWebhookPayment(event, [
        { ...attempt, orderId: '' },
      ]).status,
    ).toBe('REJECTED');
  });
});
