import { Test } from '@nestjs/testing';
import { ExecutionContext, INestApplication } from '@nestjs/common';
import request = require('supertest');
import { ShippingController } from '../src/shipping/shipping.controller';
import { ShippingService } from '../src/shipping/shipping.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { CompanyStatusGuard } from '../src/common/company-status/company-status.guard';

describe('Shipping quotes disabled HTTP', () => {
  let app: INestApplication;
  let previous: string | undefined;

  const service = {
    createRFQ: jest.fn(),
    sendQuote: jest.fn(),
    acceptQuote: jest.fn(),
    listOpen: jest.fn().mockResolvedValue([]),
    listQuotesForBuyer: jest.fn().mockResolvedValue([]),
    listShippingOrders: jest.fn().mockResolvedValue([]),
    pickup: jest.fn(),
    transit: jest.fn(),
    deliver: jest.fn(),
  };

  beforeAll(async () => {
    previous = process.env.SHIPPING_QUOTES_ENABLED;
    delete process.env.SHIPPING_QUOTES_ENABLED;

    const module = await Test.createTestingModule({
      controllers: [ShippingController],
      providers: [{ provide: ShippingService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          const match = /^Bearer (BUYER|SELLER|ADMIN|LOGISTICS)$/.exec(
            req.headers.authorization || '',
          );
          if (!match) return false;
          req.user = { role: match[1], companyId: match[1] + '-test' };
          return true;
        },
      })
      .overrideGuard(CompanyStatusGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (previous === undefined) delete process.env.SHIPPING_QUOTES_ENABLED;
    else process.env.SHIPPING_QUOTES_ENABLED = previous;
  });

  beforeEach(() => jest.clearAllMocks());

  for (const role of ['BUYER', 'SELLER', 'ADMIN', 'LOGISTICS']) {
    it(role + ' cannot create shipping RFQ', async () => {
      await request(app.getHttpServer())
        .post('/api/shipping/rfq')
        .set('Authorization', 'Bearer ' + role)
        .send({ orderId: 'test' })
        .expect(503);
      expect(service.createRFQ).not.toHaveBeenCalled();
    });

    it(role + ' cannot submit shipping quote', async () => {
      await request(app.getHttpServer())
        .post('/api/shipping/quote')
        .set('Authorization', 'Bearer ' + role)
        .send({ rfqId: 'test', price: 100 })
        .expect(503);
      expect(service.sendQuote).not.toHaveBeenCalled();
    });

    it(role + ' cannot accept shipping quote', async () => {
      await request(app.getHttpServer())
        .post('/api/shipping/quote/test/accept')
        .set('Authorization', 'Bearer ' + role)
        .expect(503);
      expect(service.acceptQuote).not.toHaveBeenCalled();
    });
  }

  it('anonymous requests remain blocked', async () => {
    await request(app.getHttpServer()).post('/api/shipping/rfq')
      .send({}).expect(403);
    expect(service.createRFQ).not.toHaveBeenCalled();
  });

  it('existing shipping orders remain readable', async () => {
    await request(app.getHttpServer())
      .get('/api/shipping/orders')
      .set('Authorization', 'Bearer BUYER')
      .expect(200);
    expect(service.listShippingOrders).toHaveBeenCalledTimes(1);
  });
});
