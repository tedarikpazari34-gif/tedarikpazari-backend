import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import request = require('supertest');

import { OrderController } from '../src/order/order.controller';
import { OrderService } from '../src/order/order.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Siparis gercek JWT HTTP sirket izolasyonu', () => {
  let app: INestApplication;
  let jwt: JwtService;

  const previousSecret = process.env.JWT_SECRET;
  const secret = 'isolated-order-access-jwt-' + 'x'.repeat(48);

  const findUser = jest.fn();
  const findMany = jest.fn();
  const findUnique = jest.fn();

  const users: Record<string, any> = {
    buyerA: {
      id: 'buyerA', email: 'buyer-a@example.test',
      companyId: 'buyer-a', sessionVersion: 0,
      company: { role: Role.BUYER, status: 'APPROVED' },
    },
    buyerB: {
      id: 'buyerB', email: 'buyer-b@example.test',
      companyId: 'buyer-b', sessionVersion: 0,
      company: { role: Role.BUYER, status: 'APPROVED' },
    },
    sellerA: {
      id: 'sellerA', email: 'seller-a@example.test',
      companyId: 'seller-a', sessionVersion: 0,
      company: { role: Role.SELLER, status: 'APPROVED' },
    },
    sellerB: {
      id: 'sellerB', email: 'seller-b@example.test',
      companyId: 'seller-b', sessionVersion: 0,
      company: { role: Role.SELLER, status: 'APPROVED' },
    },
    admin: {
      id: 'admin', email: 'admin@example.test',
      companyId: 'admin-company', sessionVersion: 0,
      company: { role: Role.ADMIN, status: 'APPROVED' },
    },
    logistics: {
      id: 'logistics', email: 'logistics@example.test',
      companyId: 'logistics-company', sessionVersion: 0,
      company: { role: Role.LOGISTICS, status: 'APPROVED' },
    },
    buyerWithoutCompanyId: {
      id: 'buyerWithoutCompanyId',
      email: 'missing-company@example.test',
      companyId: null, sessionVersion: 0,
      company: { role: Role.BUYER, status: 'APPROVED' },
    },
  };

  const secretValue = 'DO_NOT_EXPOSE_PAYMENT_SECRET';

  const orders: any[] = [
    {
      id: 'order-a', buyerId: 'buyer-a', sellerId: 'seller-a',
      status: 'PAID', totalAmount: 500,
      productTitleSnapshot: 'Ornek Urun A',
      commissionAmount: 50, payoutAmount: 450,
      iyzicoCheckoutToken: secretValue,
      iyzicoRawResult: { secret: secretValue },
      seller: {
        id: 'seller-a',
        phone: 'PRIVATE_PHONE',
        iyzicoIban: 'PRIVATE_IBAN',
      },
      buyer: { id: 'buyer-a' },
      disputes: [],
    },
    {
      id: 'order-b', buyerId: 'buyer-b', sellerId: 'seller-b',
      status: 'PAID', totalAmount: 700,
      productTitleSnapshot: 'Ornek Urun B',
      commissionAmount: 70, payoutAmount: 630,
      iyzicoCheckoutToken: secretValue,
      iyzicoRawResult: { secret: secretValue },
      seller: { id: 'seller-b' },
      buyer: { id: 'buyer-b' },
      disputes: [],
    },
  ];

  function applySelect(value: any, select: any): any {
    if (value == null || !select) return value;

    if (Array.isArray(value)) {
      return value.map(item => applySelect(item, select));
    }

    const result: Record<string, any> = {};

    for (const [key, rule] of Object.entries(select)) {
      if (!(key in value)) continue;

      if (rule === true) {
        result[key] = value[key];
      } else if (rule && typeof rule === 'object') {
        const nested = (rule as any).select;
        if (nested) {
          result[key] = applySelect(value[key], nested);
        }
      }
    }

    return result;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;

    const prisma = {
      user: { findUnique: findUser },
      order: { findMany, findUnique },
    };

    const service = new OrderService(
      prisma as any,
      {} as any,
      {} as any,
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
    await app.init();

    jwt = module.get(JwtService);
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (previousSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = previousSecret;
      }
    }
  });

  beforeEach(() => {
    jest.resetAllMocks();

    findUser.mockImplementation(async ({ where }: any) =>
      users[where.id] ?? null,
    );

    findMany.mockImplementation(async ({ where, select }: any) =>
      orders
        .filter(order =>
          !where ||
          Object.entries(where).every(
            ([key, value]) => order[key] === value,
          ),
        )
        .map(order => applySelect(order, select)),
    );

    findUnique.mockImplementation(async ({ where, select }: any) => {
      const order = orders.find(item => item.id === where.id);
      return order ? applySelect(order, select) : null;
    });
  });

  async function token(id: string, claims: Record<string, any> = {}) {
    return jwt.signAsync({
      sub: id,
      sessionVersion: 0,
      ...claims,
    });
  }

  function list(tokenValue?: string) {
    const call = request(app.getHttpServer()).get('/api/orders');
    return tokenValue
      ? call.set('Authorization', 'Bearer ' + tokenValue)
      : call;
  }

  function detail(id: string, tokenValue?: string) {
    const call = request(app.getHttpServer())
      .get('/api/orders/' + id);
    return tokenValue
      ? call.set('Authorization', 'Bearer ' + tokenValue)
      : call;
  }

  it('JWT olmadan siparis listesi 401', async () => {
    await list().expect(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('JWT olmadan siparis detayi 401', async () => {
    await detail('order-a').expect(401);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('yanlis imzali JWT 401', async () => {
    const invalid = await new JwtService({
      secret: 'different-secret-' + 'z'.repeat(48),
    }).signAsync({ sub: 'buyerA', sessionVersion: 0 });

    await list(invalid).expect(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('suresi dolmus JWT 401', async () => {
    const expired = await token('buyerA', {
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    await list(expired).expect(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('eski oturum surumlu JWT 401', async () => {
    const stale = await token('buyerA', { sessionVersion: 99 });
    await list(stale).expect(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['buyerA', 'order-a', { buyerId: 'buyer-a' }],
    ['sellerA', 'order-a', { sellerId: 'seller-a' }],
    ['buyerB', 'order-b', { buyerId: 'buyer-b' }],
    ['sellerB', 'order-b', { sellerId: 'seller-b' }],
  ])(
    '%s yalnizca kendi sirketinin siparislerini listeler',
    async (actor, expectedId, expectedWhere) => {
      const response = await list(await token(actor as string))
        .expect(200);

      expect(response.body.map((item: any) => item.id))
        .toEqual([expectedId]);
      expect(findMany.mock.calls[0][0].where)
        .toEqual(expectedWhere);
      expect(JSON.stringify(response.body)).not.toContain(secretValue);
    },
  );

  it('ADMIN iki sirketin siparislerini listeler', async () => {
    const response = await list(await token('admin')).expect(200);
    expect(response.body.map((item: any) => item.id))
      .toEqual(['order-a', 'order-b']);
    expect(findMany.mock.calls[0][0].where).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain(secretValue);
  });

  it.each([
    ['buyerA', 'order-a'],
    ['sellerA', 'order-a'],
    ['buyerB', 'order-b'],
    ['sellerB', 'order-b'],
  ])('%s kendi siparis detayini gorur', async (actor, id) => {
    const response = await detail(
      id as string, await token(actor as string),
    ).expect(200);

    expect(response.body.id).toBe(id);
    expect(JSON.stringify(response.body)).not.toContain(secretValue);
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_IBAN');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_PHONE');
  });

  it.each([
    ['buyerA', 'order-b'],
    ['sellerA', 'order-b'],
    ['buyerB', 'order-a'],
    ['sellerB', 'order-a'],
  ])(
    '%s baska sirketin %s siparisini goremez',
    async (actor, id) => {
      await detail(
        id as string, await token(actor as string),
      ).expect(403);
    },
  );

  it('ADMIN her iki sirketin detayina erisir', async () => {
    const adminToken = await token('admin');
    await detail('order-a', adminToken).expect(200);
    await detail('order-b', adminToken).expect(200);
  });

  it('LOGISTICS siparis listesini goremez', async () => {
    await list(await token('logistics')).expect(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('LOGISTICS siparis detayini goremez', async () => {
    await detail('order-a', await token('logistics')).expect(403);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('sirket kimligi eksik alici 403 alir', async () => {
    await list(await token('buyerWithoutCompanyId')).expect(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('JWT icindeki sahte ADMIN rolu yetki kazandirmaz', async () => {
    const forged = await token('buyerA', {
      role: 'ADMIN',
      companyId: 'admin-company',
    });

    const response = await list(forged).expect(200);
    expect(response.body.map((item: any) => item.id))
      .toEqual(['order-a']);
    expect(findMany.mock.calls[0][0].where)
      .toEqual({ buyerId: 'buyer-a' });
    expect(response.body[0]).not.toHaveProperty('commissionAmount');
    expect(response.body[0]).not.toHaveProperty('payoutAmount');
  });

  it('JWT icindeki sahte sirket kimligi erisim saglamaz', async () => {
    const forged = await token('sellerB', {
      role: 'SELLER',
      companyId: 'seller-a',
    });

    await detail('order-a', forged).expect(403);
  });

  it('var olmayan siparis 404 doner', async () => {
    await detail('nonexistent-order', await token('buyerA'))
      .expect(404);
  });
});
