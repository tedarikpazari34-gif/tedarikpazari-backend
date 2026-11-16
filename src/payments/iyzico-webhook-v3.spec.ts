import { createHmac } from 'node:crypto';
import { verifyIyzicoWebhookV3 } from './iyzico-webhook-v3';

describe('iyzico Webhook V3 signature verification', () => {
  const secret = 'test-only-secret-key';

  const validEvent = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: '123456789',
    token: 'test-checkout-token',
    paymentConversationId: 'ord_test_123',
    status: 'SUCCESS',
  };

  function sign(payload: typeof validEvent, key = secret): string {
    const message =
      key +
      payload.iyziEventType +
      payload.iyziPaymentId +
      payload.token +
      payload.paymentConversationId +
      payload.status;

    return createHmac('sha256', key)
      .update(message, 'utf8')
      .digest('hex');
  }

  it('accepts a correctly signed checkout form event', () => {
    expect(
      verifyIyzicoWebhookV3(validEvent, sign(validEvent), secret),
    ).toEqual(validEvent);
  });

  it('rejects a forged signature', () => {
    expect(
      verifyIyzicoWebhookV3(validEvent, '0'.repeat(64), secret),
    ).toBeNull();
  });

  it('rejects a signature created with another secret', () => {
    expect(
      verifyIyzicoWebhookV3(validEvent, sign(validEvent, 'wrong-secret'), secret),
    ).toBeNull();
  });

  it('rejects modified payment data', () => {
    const tampered = { ...validEvent, iyziPaymentId: '999999999' };

    expect(
      verifyIyzicoWebhookV3(tampered, sign(validEvent), secret),
    ).toBeNull();
  });

  it('rejects modified status', () => {
    const tampered = { ...validEvent, status: 'FAILURE' };

    expect(
      verifyIyzicoWebhookV3(tampered, sign(validEvent), secret),
    ).toBeNull();
  });

  it('rejects missing fields', () => {
    const incomplete = { ...validEvent, token: '' };

    expect(
      verifyIyzicoWebhookV3(incomplete, sign(validEvent), secret),
    ).toBeNull();
  });

  it('rejects unsupported event types', () => {
    const unsupported = {
      ...validEvent,
      iyziEventType: 'OTHER_EVENT',
    };

    expect(
      verifyIyzicoWebhookV3(unsupported, sign(unsupported), secret),
    ).toBeNull();
  });

  it('rejects malformed signatures', () => {
    expect(
      verifyIyzicoWebhookV3(validEvent, 'not-a-valid-signature', secret),
    ).toBeNull();
  });

  it('rejects missing secret keys', () => {
    expect(
      verifyIyzicoWebhookV3(validEvent, sign(validEvent), undefined),
    ).toBeNull();
  });

  it('accepts uppercase hexadecimal signatures', () => {
    expect(
      verifyIyzicoWebhookV3(validEvent, sign(validEvent).toUpperCase(), secret),
    ).toEqual(validEvent);
  });

  it('accepts safely represented numeric payment IDs', () => {
    const numericPayload = {
      ...validEvent,
      iyziPaymentId: 123456789,
    };

    expect(
      verifyIyzicoWebhookV3(numericPayload, sign(validEvent), secret),
    ).toEqual(validEvent);
  });

  it('rejects unsafe numeric payment IDs', () => {
    const unsafePayload = {
      ...validEvent,
      iyziPaymentId: Number.MAX_SAFE_INTEGER + 1,
    };

    expect(
      verifyIyzicoWebhookV3(unsafePayload, sign(validEvent), secret),
    ).toBeNull();
  });
});
