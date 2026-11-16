import { Test } from '@nestjs/testing';
import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import request = require('supertest');
import { OrderController } from '../src/order/order.controller';
import { OrderService } from '../src/order/order.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('Gönderim HTTP yetki ve bildirim akışı — mock altyapı', () => {
  let app: INestApplication;
  let currentOrder: any;

  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const findBuyer = jest.fn();
  const notify = jest.fn();
  const sendMail = jest.fn();

  const cargo = {
    shippingMethod: 'CARGO',
    shippingCompany: 'Örnek Kargo',
    shippingTrackingNo: 'KRG-123',
  };
  const freight = {
    shippingMethod: 'FREIGHT',
    shippingCompany: 'Örnek Ambar',
    shippingTrackingNo: 'AMB-456',
    shippingDispatchNo: 'IRS-789',
  };

  beforeAll(async () => {
    const service = new OrderService(
      {
        order: { findUnique, updateMany },
        user: { findFirst: findBuyer },
      } as any,
      { createNotification: notify } as any,
      { sendMail } as any,
      {} as any,
    );

    const module = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [{ provide: OrderService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();
          const identities: Record<string, any> = {
            seller: { role: 'SELLER', companyId: 'seller-1' },
            otherSeller: { role: 'SELLER', companyId: 'seller-other' },
            buyer: { role: 'BUYER', companyId: 'buyer-1' },
            admin: { role: 'ADMIN' },
            logistics: { role: 'LOGISTICS', companyId: 'logistics-1' },
          };
          const token = (req.headers.authorization || '').replace(/^Bearer /, '');
          if (!identities[token]) throw new UnauthorizedException();
          req.user = identities[token];
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    currentOrder = {
      id: 'order-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      status: OrderStatus.PREPARING,
    };
    findUnique.mockImplementation(async ({ where }: any) =>
      currentOrder && where.id === currentOrder.id
        ? { ...currentOrder }
        : null,
    );
    updateMany.mockImplementation(async ({ where, data }: any) => {
      if (
        !currentOrder ||
        where.id !== currentOrder.id ||
        where.sellerId !== currentOrder.sellerId ||
        where.status !== currentOrder.status
      ) return { count: 0 };
      currentOrder = { ...currentOrder, ...data };
      return { count: 1 };
    });
    findBuyer.mockResolvedValue({
      id: 'buyer-user-1',
      email: 'buyer@example.test',
    });
    notify.mockResolvedValue({});
    sendMail.mockResolvedValue({});
  });

  function ship(token?: string, body: any = cargo) {
    const req = request(app.getHttpServer()).post('/api/orders/order-1/ship');
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req.send(body);
  }

  function expectNoEffects() {
    expect(updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  }

  it('kimliksiz isteği reddeder', async () => {
    await ship().expect(401);
    expectNoEffects();
  });

  for (const role of ['buyer', 'admin', 'logistics', 'otherSeller']) {
    it(role + ' gönderim başlatamaz', async () => {
      await ship(role).expect(403);
      expectNoEffects();
    });
  }

  for (const [label, body] of [
    ['kargo', cargo],
    ['ambar', freight],
  ] as const) {
    it(label + ' gönderimini kaydeder ve alıcıya bildirir', async () => {
      const response = await ship('seller', body).expect(201);
      expect(response.body.order).toMatchObject({
        ...body,
        status: 'SHIPPED',
      });
      expect(findBuyer).toHaveBeenCalledWith({
        where: { companyId: 'buyer-1' },
      });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0][0]).toMatchObject({
        userId: 'buyer-user-1',
        link: '/buyer/orders',
      });
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0][0].to).toBe('buyer@example.test');
    });

    it(label + ' bildirim hatasında e-postayı gönderir', async () => {
      notify.mockRejectedValue(new Error('Mock notification failure'));
      await ship('seller', body).expect(201);
      expect(currentOrder.status).toBe(OrderStatus.SHIPPED);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it(label + ' iki kanal hatasında gönderimi korur, tekrarı reddeder', async () => {
      notify.mockRejectedValue(new Error('Mock notification failure'));
      sendMail.mockRejectedValue(new Error('Mock mail failure'));
      await ship('seller', body).expect(201);
      await ship('seller', body).expect(400);
      expect(currentOrder.status).toBe(OrderStatus.SHIPPED);
      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  }

  const invalidBodies = [
    { ...cargo, shippingMethod: 'INVALID' },
    { ...cargo, shippingCompany: '   ' },
    { ...cargo, shippingTrackingNo: '' },
    { ...cargo, shippingDispatchNo: '   ' },
    { ...cargo, shippingCompany: 'x'.repeat(101) },
    { ...cargo, shippingTrackingNo: 'x'.repeat(151) },
    { ...freight, shippingDispatchNo: 'x'.repeat(101) },
    { shippingMethod: 'CARGO', shippingCompany: 'Firma' },
    { ...cargo, sellerId: 'seller-other' },
    { ...cargo, status: 'COMPLETED' },
  ];

  invalidBodies.forEach((body, index) => {
    it('geçersiz gönderim verisini reddeder: ' + (index + 1), async () => {
      await ship('seller', body).expect(400);
      expectNoEffects();
    });
  });

  it('bulunamayan siparişi reddeder', async () => {
    currentOrder = null;
    await ship('seller').expect(404);
    expectNoEffects();
  });

  it('hazırlanmayan siparişi reddeder', async () => {
    currentOrder.status = OrderStatus.PAID;
    await ship('seller').expect(400);
    expectNoEffects();
  });

  it('eşzamanlı durum değişiminde bildirim göndermez', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await ship('seller').expect(400);
    expect(notify).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });
});
