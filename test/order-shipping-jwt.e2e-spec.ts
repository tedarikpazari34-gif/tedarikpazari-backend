import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { OrderStatus } from '@prisma/client';
import request = require('supertest');
import { OrderController } from '../src/order/order.controller';
import { OrderService } from '../src/order/order.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Gönderim gerçek JWT HTTP güvenliği — mock veritabanı', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let currentOrder: any;
  let users: Record<string, any>;

  const previousSecret = process.env.JWT_SECRET;
  const secret = 'isolated-shipping-jwt-test-' + 'x'.repeat(48);
  const findUser = jest.fn();
  const findOrder = jest.fn();
  const updateMany = jest.fn();
  const findBuyer = jest.fn();
  const notify = jest.fn();
  const sendMail = jest.fn();

  const body = {
    shippingMethod: 'CARGO',
    shippingCompany: 'Örnek Kargo',
    shippingTrackingNo: 'KRG-123',
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;

    const prisma = {
      user: { findUnique: findUser, findFirst: findBuyer },
      order: { findUnique: findOrder, updateMany },
    };
    const service = new OrderService(
      prisma as any,
      { createNotification: notify } as any,
      { sendMail } as any,
      {} as any,
    );

    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret })],
      controllers: [OrderController],
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: OrderService, useValue: service },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
    jwt = module.get(JwtService);
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  beforeEach(() => {
    jest.resetAllMocks();
    users = {};
    for (const [id, role, companyId] of [
      ['seller', 'SELLER', 'seller-1'],
      ['otherSeller', 'SELLER', 'seller-other'],
      ['buyer', 'BUYER', 'buyer-1'],
      ['admin', 'ADMIN', 'admin-1'],
      ['logistics', 'LOGISTICS', 'logistics-1'],
    ]) {
      users[id] = {
        id,
        email: id + '@example.test',
        companyId,
        sessionVersion: 0,
        company: { role, status: 'APPROVED' },
      };
    }

    currentOrder = {
      id: 'order-1',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      status: OrderStatus.PREPARING,
    };
    findUser.mockImplementation(async ({ where }: any) =>
      users[where.id] || null,
    );
    findOrder.mockImplementation(async ({ where }: any) =>
      where.id === currentOrder.id ? { ...currentOrder } : null,
    );
    updateMany.mockImplementation(async ({ where, data }: any) => {
      if (
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

  function ship(token?: string) {
    const req = request(app.getHttpServer()).post('/api/orders/order-1/ship');
    if (token) req.set('Authorization', 'Bearer ' + token);
    return req.send(body);
  }

  function expectNoEffects() {
    expect(findOrder).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  }

  it('JWT olmadan reddeder', async () => {
    await ship().expect(401);
    expectNoEffects();
  });

  it('yanlış anahtarla imzalanmış JWT reddedilir', async () => {
    const token = await new JwtService({
      secret: 'different-test-secret-' + 'z'.repeat(48),
    }).signAsync({ sub: 'seller', sessionVersion: 0 });
    await ship(token).expect(401);
    expect(findUser).not.toHaveBeenCalled();
    expectNoEffects();
  });

  it('süresi dolmuş JWT reddedilir', async () => {
    const token = await jwt.signAsync({
      sub: 'seller',
      sessionVersion: 0,
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    await ship(token).expect(401);
    expect(findUser).not.toHaveBeenCalled();
    expectNoEffects();
  });

  it('eski oturum sürümü reddedilir', async () => {
    users.seller.sessionVersion = 1;
    const token = await jwt.signAsync({ sub: 'seller', sessionVersion: 0 });
    await ship(token).expect(401);
    expectNoEffects();
  });

  it('oturum sürümü olmayan JWT reddedilir', async () => {
    const token = await jwt.signAsync({ sub: 'seller' });
    await ship(token).expect(401);
    expectNoEffects();
  });

  it('silinmiş kullanıcı reddedilir', async () => {
    delete users.seller;
    const token = await jwt.signAsync({ sub: 'seller', sessionVersion: 0 });
    await ship(token).expect(401);
    expectNoEffects();
  });

  it('şirketi bulunmayan kullanıcı reddedilir', async () => {
    users.seller.company = null;
    const token = await jwt.signAsync({ sub: 'seller', sessionVersion: 0 });
    await ship(token).expect(401);
    expectNoEffects();
  });

  for (const id of ['buyer', 'admin', 'logistics', 'otherSeller']) {
    it(id + ' geçerli JWT ile gönderim başlatamaz', async () => {
      const token = await jwt.signAsync({ sub: id, sessionVersion: 0 });
      await ship(token).expect(403);
      expect(updateMany).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });
  }

  it('token içindeki satıcı rolü alıcıya yetki vermez', async () => {
    const token = await jwt.signAsync({
      sub: 'buyer',
      sessionVersion: 0,
      role: 'SELLER',
      companyId: 'seller-1',
    });
    await ship(token).expect(403);
    expectNoEffects();
  });

  it('token içindeki şirket başka satıcıya erişim sağlamaz', async () => {
    const token = await jwt.signAsync({
      sub: 'otherSeller',
      sessionVersion: 0,
      role: 'SELLER',
      companyId: 'seller-1',
    });
    await ship(token).expect(403);
    expect(updateMany).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('yetkili satıcı güncel veritabanı kimliğiyle gönderir', async () => {
    const token = await jwt.signAsync({
      sub: 'seller',
      sessionVersion: 0,
      role: 'BUYER',
      companyId: 'wrong-company',
    });
    const response = await ship(token).expect(201);
    expect(response.body.order.status).toBe('SHIPPED');
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0][0].where.sellerId).toBe('seller-1');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
