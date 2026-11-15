import { createHmac, timingSafeEqual } from 'node:crypto';

export interface IyzicoWebhookV3Event {
  iyziEventType: string;
  iyziPaymentId: string;
  token: string;
  paymentConversationId: string;
  status: string;
}

function readField(
  payload: Record<string, unknown>,
  field: keyof IyzicoWebhookV3Event,
): string | null {
  const value = payload[field];

  if (typeof value === 'string' && value.length > 0) {
    return value === value.trim() ? value : null;
  }

  if (
    field === 'iyziPaymentId' &&
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return String(value);
  }

  return null;
}

export function verifyIyzicoWebhookV3(
  payload: unknown,
  signatureHeader: unknown,
  secretKey: string | undefined,
): IyzicoWebhookV3Event | null {
  if (
    !secretKey ||
    typeof signatureHeader !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(signatureHeader) ||
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return null;
  }

  const body = payload as Record<string, unknown>;

  const fields = [
    'iyziEventType',
    'iyziPaymentId',
    'token',
    'paymentConversationId',
    'status',
  ] as const;

  const values = fields.map((field) => readField(body, field));

  if (values.some((value) => value === null)) {
    return null;
  }

  const [
    iyziEventType,
    iyziPaymentId,
    token,
    paymentConversationId,
    status,
  ] = values as string[];

  if (iyziEventType !== 'CHECKOUT_FORM_AUTH') {
    return null;
  }

  const message =
    secretKey +
    iyziEventType +
    iyziPaymentId +
    token +
    paymentConversationId +
    status;

  const expected = createHmac('sha256', secretKey)
    .update(message, 'utf8')
    .digest();

  const received = Buffer.from(signatureHeader, 'hex');

  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return null;
  }

  return {
    iyziEventType,
    iyziPaymentId,
    token,
    paymentConversationId,
    status,
  };
}
