import { createHmac } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '../prisma/prisma.service';
import { IyzicoWebhookController } from './iyzico-webhook.controller';
import { IyzicoWebhookService } from './iyzico-webhook.service';
import { IyzicoWebhookEventStore } from './iyzico-webhook-event-store';
import { IyzicoWebhookNotifier } from './iyzico-webhook-notifier.service';

describe('Iyzico Webhook V3 HTTP integration', () => {
  const secret = 'isolated-http-test-secret';
  const event = {
    iyziEventType: 'CHECKOUT_FORM_AUTH',
    iyziPaymentId: 'payment-http',
    token: 'token-http',
    paymentConversationId: 'conversation-http',
    status: 'SUCCESS',
  };

  let app: INestApplication;
  let prisma: any;
  let notifier: any;

  function signature(payload: typeof event): string {
    const message =
      secret +
      payload.iyziEventType +
      payload.iyziPaymentId +
      payload.token +
      payload.paymentConversationId +
      payload.status;

    return createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest('hex');
  }

  beforeAll(async () => {
    process.env.IYZICO_SECRET_KEY = secret;

    prisma = {
      paymentAttempt: {
        findMany: jest.fn(),
      },
      iyzicoWebhookEvent: {
        createMany: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    prisma.$transaction = jest.fn(async (callback: any) => callback(prisma));

    notifier = {
      stage: jest.fn(),
      publish: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [IyzicoWebhookController],
      providers: [
        IyzicoWebhookService,
        IyzicoWebhookEventStore,
        {
          provide: IyzicoWebhookNotifier,
          useValue: notifier,
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    jest.resetAllMocks();

    prisma.$transaction.mockImplementation(
      async (callback: any) => callback(prisma),
    );
    notifier.stage.mockResolvedValue([]);
    prisma.iyzicoWebhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: 'webhook-event-http',
      status: 'INVESTIGATION_REQUIRED',
    });

    prisma.paymentAttempt.findMany.mockResolvedValue([{
      id: 'attempt-http',
      orderId: 'order-http',
      provider: 'IYZICO',
      conversationId: event.paymentConversationId,
      checkoutToken: event.token,
      iyzicoPaymentId: event.iyziPaymentId,
    }]);

    prisma.iyzicoWebhookEvent.createMany.mockResolvedValue({
      count: 1,
    });

    prisma.iyzicoWebhookEvent.update.mockResolvedValue({
      status: 'RECEIVED',
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.IYZICO_SECRET_KEY;
  });

  it('accepts a signed matched event only after persistence', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/iyzico/webhook')
      .set('x-iyz-signature-v3', signature(event))
      .send(event);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(prisma.iyzicoWebhookEvent.createMany)
      .toHaveBeenCalledTimes(1);
  });

  it('rejects invalid signatures without database access', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/iyzico/webhook')
      .set('x-iyz-signature-v3', '0'.repeat(64))
      .send(event);

    expect(response.status).toBe(401);
    expect(prisma.paymentAttempt.findMany).not.toHaveBeenCalled();
    expect(prisma.iyzicoWebhookEvent.createMany).not.toHaveBeenCalled();
  });

  it('rejects mismatched checkout tokens without persistence', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([{
      id: 'attempt-http',
      orderId: 'order-http',
      provider: 'IYZICO',
      conversationId: event.paymentConversationId,
      checkoutToken: 'different-token',
      iyzicoPaymentId: event.iyziPaymentId,
    }]);

    const response = await request(app.getHttpServer())
      .post('/payments/iyzico/webhook')
      .set('x-iyz-signature-v3', signature(event))
      .send(event);

    expect(response.status).toBe(401);
    expect(prisma.iyzicoWebhookEvent.createMany).not.toHaveBeenCalled();
  });

  it('preserves persisted investigation events without payment approval', async () => {
    prisma.paymentAttempt.findMany.mockResolvedValue([{
      id: 'attempt-http',
      orderId: 'order-http',
      provider: 'IYZICO',
      conversationId: event.paymentConversationId,
      checkoutToken: null,
      iyzicoPaymentId: event.iyziPaymentId,
    }]);

    const response = await request(app.getHttpServer())
      .post('/payments/iyzico/webhook')
      .set('x-iyz-signature-v3', signature(event))
      .send(event);

    expect(response.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.iyzicoWebhookEvent.createMany)
      .toHaveBeenCalledWith(expect.objectContaining({
        data: [expect.objectContaining({
          status: 'INVESTIGATION_REQUIRED',
        })],
      }));
  });

  it('does not acknowledge failed persistence', async () => {
    prisma.iyzicoWebhookEvent.createMany.mockRejectedValue(
      new Error('Isolated persistence failure'),
    );

    const response = await request(app.getHttpServer())
      .post('/payments/iyzico/webhook')
      .set('x-iyz-signature-v3', signature(event))
      .send(event);

    expect(response.status).toBe(500);
    expect(response.body.received).not.toBe(true);
  });

  it('increments duplicate delivery metadata without changing payment state', async () => {
    prisma.iyzicoWebhookEvent.createMany.mockResolvedValue({
      count: 0,
    });

    const response = await request(app.getHttpServer())
      .post('/payments/iyzico/webhook')
      .set('x-iyz-signature-v3', signature(event))
      .send(event);

    expect(response.status).toBe(200);
    expect(prisma.iyzicoWebhookEvent.update)
      .toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          deliveryCount: { increment: 1 },
        }),
      }));
    expect(prisma.paymentAttempt.findMany).toHaveBeenCalledTimes(1);
  });
});
