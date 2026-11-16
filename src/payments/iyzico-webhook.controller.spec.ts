import { HttpStatus } from '@nestjs/common';
import { IyzicoWebhookController } from './iyzico-webhook.controller';

describe('IyzicoWebhookController', () => {
  let controller: IyzicoWebhookController;
  let webhook: { inspect: jest.Mock };

  const payload = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: 'payment-test',
    token: 'secret-test-token',
    paymentConversationId: 'conversation-test',
    status: 'SUCCESS',
  };

  const req = {
    headers: {
      'x-iyz-signature-v3': 'test-signature',
    },
  };

  beforeEach(() => {
    webhook = {
      inspect: jest.fn(),
    };

    controller = new IyzicoWebhookController(webhook as any);
  });

  it('returns a minimal response for matched events', async () => {
    webhook.inspect.mockResolvedValue({
      status: 'MATCHED',
      paymentAttemptId: 'attempt-test',
      orderId: 'order-test',
    });

    await expect(
      controller.receive(payload, req as any),
    ).resolves.toEqual({ received: true });

    expect(webhook.inspect).toHaveBeenCalledWith(
      payload,
      'test-signature',
    );
  });

  it('rejects invalid events with HTTP 401', async () => {
    webhook.inspect.mockResolvedValue({
      status: 'REJECTED',
      reason: 'Invalid signature',
    });

    await expect(
      controller.receive(payload, req as any),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('acknowledges durably recorded investigation events with HTTP 200', async () => {
    webhook.inspect.mockResolvedValue({
      status: 'INVESTIGATION_REQUIRED',
      paymentAttemptId: 'attempt-test',
      orderId: 'order-test',
      reason: 'Token missing',
    });

    await expect(
      controller.receive(payload, req as any),
    ).resolves.toEqual({ received: true });
  });

  it('does not acknowledge persistence errors', async () => {
    webhook.inspect.mockRejectedValue(new Error('DB write failed'));

    await expect(
      controller.receive(payload, req as any),
    ).rejects.toThrow('DB write failed');
  });

  it('does not expose payment data in successful responses', async () => {
    webhook.inspect.mockResolvedValue({
      status: 'MATCHED',
      paymentAttemptId: 'attempt-test',
      orderId: 'order-test',
    });

    const response = await controller.receive(payload, req as any);
    const serialized = JSON.stringify(response);

    expect(serialized).not.toContain(payload.token);
    expect(serialized).not.toContain(payload.iyziPaymentId);
    expect(serialized).not.toContain(payload.paymentConversationId);
    expect(serialized).not.toContain('order-test');
    expect(serialized).not.toContain('attempt-test');
  });

  it('does not acknowledge rejected events as received', async () => {
    webhook.inspect.mockResolvedValue({
      status: 'REJECTED',
      reason: 'Payment mismatch',
    });

    await expect(
      controller.receive(payload, req as any),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
    });
  });
});
