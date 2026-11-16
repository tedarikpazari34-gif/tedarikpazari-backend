import { createIyzicoWebhookEventKey } from './iyzico-webhook-event-key';
import type { IyzicoWebhookV3Event } from './iyzico-webhook-v3';

describe('iyzico Webhook V3 event identity', () => {
  const event: IyzicoWebhookV3Event = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: '123456789',
    token: 'secret-checkout-token',
    paymentConversationId: 'ord_123',
    status: 'SUCCESS',
  };

  it('produces the same key for repeated identical events', () => {
    expect(createIyzicoWebhookEventKey(event))
      .toBe(createIyzicoWebhookEventKey({ ...event }));
  });

  it('produces a 64-character SHA256 hexadecimal key', () => {
    expect(createIyzicoWebhookEventKey(event))
      .toMatch(/^[a-f0-9]{64}$/);
  });

  it('distinguishes different payment IDs', () => {
    expect(createIyzicoWebhookEventKey(event))
      .not.toBe(createIyzicoWebhookEventKey({
        ...event,
        iyziPaymentId: '987654321',
      }));
  });

  it('distinguishes different payment statuses', () => {
    expect(createIyzicoWebhookEventKey(event))
      .not.toBe(createIyzicoWebhookEventKey({
        ...event,
        status: 'FAILURE',
      }));
  });

  it('distinguishes different checkout tokens', () => {
    expect(createIyzicoWebhookEventKey(event))
      .not.toBe(createIyzicoWebhookEventKey({
        ...event,
        token: 'another-checkout-token',
      }));
  });

  it('distinguishes different conversation IDs', () => {
    expect(createIyzicoWebhookEventKey(event))
      .not.toBe(createIyzicoWebhookEventKey({
        ...event,
        paymentConversationId: 'ord_456',
      }));
  });

  it('distinguishes different event types', () => {
    expect(createIyzicoWebhookEventKey(event))
      .not.toBe(createIyzicoWebhookEventKey({
        ...event,
        iyziEventType: 'OTHER_EVENT',
      }));
  });

  it('prevents concatenation ambiguity between fields', () => {
    const first = {
      ...event,
      token: 'ab',
      paymentConversationId: 'c',
    };

    const second = {
      ...event,
      token: 'a',
      paymentConversationId: 'bc',
    };

    expect(createIyzicoWebhookEventKey(first))
      .not.toBe(createIyzicoWebhookEventKey(second));
  });

  it('does not expose raw checkout token in the key', () => {
    const key = createIyzicoWebhookEventKey(event);

    expect(key).not.toContain(event.token);
    expect(key).not.toContain(event.paymentConversationId);
  });

  it('does not mutate the webhook payload', () => {
    const frozen = Object.freeze({ ...event });

    expect(() => createIyzicoWebhookEventKey(frozen))
      .not.toThrow();

    expect(frozen).toEqual(event);
  });
});
