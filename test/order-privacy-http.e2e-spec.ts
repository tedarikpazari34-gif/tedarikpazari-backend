import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import request = require('supertest');

import { OrderController } from '../src/order/order.controller';
import { OrderService } from '../src/order/order.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationService } from '../src/notification/notification.service';
import { MailService } from '../src/mail/mail.service';
import { IyzicoService } from '../src/payments/iyzico.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('Order HTTP access isolation', () => {
  let app: INestApplication;

  const findMany = jest.fn();
  const findUnique = jest.fn();
  const secret = 'SECRET_PAYMENT_TOKEN';
  const record = {
    id: 'order-1', buyerId: 'buyer-company',
    sellerId: 'different-seller-company', status: 'PAID',
    productTitleSnapshot: 'Test Ürünü',
    iyzicoCheckoutToken: secret,
    iyzicoRawResult: { secret },
    commissionAmount: 10, payoutAmount: 90,
  };
  const selectFields = (select: any) =>
    Object.fromEntries(Object.keys(select).filter(k => select[k] === true && k in record)
      .map(k => [k, (record as any)[k]]));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [
        OrderService,
        { provide: PrismaService, useValue: { order: { findMany, findUnique } } },
        { provide: NotificationService, useValue: {} },
        { provide: MailService, useValue: {} },
        { provide: IyzicoService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          const match = /^Bearer (buyer|seller|admin)$/.exec(
            req.headers.authorization || '',
          );
          if (!match) return false;
          req.user = {
            role: match[1].toUpperCase(),
            companyId: match[1] + '-company',
          };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockImplementation(async ({ select }: any) => [selectFields(select)]);
    findUnique.mockImplementation(async ({ select }: any) => selectFields(select));
  });

  it('alıcı HTTP listesinde ödeme sırları ve finans alanları yok', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders').set('Authorization', 'Bearer buyer').expect(200);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(res.body[0]).not.toHaveProperty('commissionAmount');
    expect(res.body[0]).not.toHaveProperty('payoutAmount');
    expect(findMany.mock.calls[0][0].where).toEqual({ buyerId: 'buyer-company' });
  });

  it('alıcı HTTP detayında ödeme sırları ve finans alanları yok', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders/order-1').set('Authorization', 'Bearer buyer').expect(200);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(res.body).not.toHaveProperty('commissionAmount');
    expect(res.body).not.toHaveProperty('payoutAmount');
  });

  it('başka şirketin sipariş detayı reddedilir', async () => {
    await request(app.getHttpServer())
      .get('/api/orders/order-1').set('Authorization', 'Bearer seller').expect(404);
  });

  it('yönetici ödeme sırlarını göremez', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/orders/order-1').set('Authorization', 'Bearer admin').expect(200);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(findUnique.mock.calls[0][0].select.commissionAmount).toBe(true);
  });
});
