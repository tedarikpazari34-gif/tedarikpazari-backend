import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import request = require('supertest');

import { OrderController } from '../src/order/order.controller';
import { OrderService } from '../src/order/order.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('Order HTTP access isolation', () => {
  let app: INestApplication;

  const list = jest.fn();
  const getOne = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [OrderController],
      providers: [{
        provide: OrderService,
        useValue: { list, getOne },
      }],
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
    list.mockResolvedValue([]);
    getOne.mockResolvedValue({ id: 'order-1' });
  });

  it('kimliksiz sipariş listesini reddeder', async () => {
    await request(app.getHttpServer())
      .get('/api/orders')
      .expect(403);
    expect(list).not.toHaveBeenCalled();
  });

  it('kimliksiz sipariş detayını reddeder', async () => {
    await request(app.getHttpServer())
      .get('/api/orders/order-1')
      .expect(403);
    expect(getOne).not.toHaveBeenCalled();
  });

  for (const role of ['buyer', 'seller', 'admin']) {
    it(role + ' rolünü liste servisine doğru aktarır', async () => {
      await request(app.getHttpServer())
        .get('/api/orders')
        .set('Authorization', 'Bearer ' + role)
        .expect(200);

      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          role: role.toUpperCase(),
          companyId: role + '-company',
        }),
      );
    });

    it(role + ' rolünü detay servisine doğru aktarır', async () => {
      await request(app.getHttpServer())
        .get('/api/orders/order-1')
        .set('Authorization', 'Bearer ' + role)
        .expect(200);

      expect(getOne).toHaveBeenCalledWith(
        expect.objectContaining({
          role: role.toUpperCase(),
          companyId: role + '-company',
        }),
        'order-1',
      );
    });
  }
});
