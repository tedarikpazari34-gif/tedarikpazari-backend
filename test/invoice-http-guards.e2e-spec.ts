import { Test } from '@nestjs/testing';
import { INestApplication, ExecutionContext } from '@nestjs/common';
import request = require('supertest');

import { InvoiceController } from '../src/invoice/invoice.controller';
import { InvoiceService } from '../src/invoice/invoice.service';
import { SellerInvoiceUploadService } from '../src/invoice/invoice-upload.service';
import { ReturnInvoiceUploadService } from '../src/invoice/invoice-return-upload.service';
import { AdminInvoiceReviewService } from '../src/invoice/invoice-review.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { AdminGuard } from '../src/common/guards/admin.guard';
import { InvoiceWriteGuard } from '../src/invoice/invoice-write.guard';

describe('Isolated invoice HTTP route guards', () => {
  let app: INestApplication;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_INVOICE_WRITE: process.env.ENABLE_INVOICE_WRITE,
    ALLOW_LIVE_INVOICE_WRITE: process.env.ALLOW_LIVE_INVOICE_WRITE,
  };

  const mine = jest.fn().mockResolvedValue([]);
  const adminList = jest.fn().mockResolvedValue([]);
  const download = jest.fn().mockResolvedValue({ url: 'mock-url' });
  const access = jest.fn().mockResolvedValue({ allowed: true });
  const sale = jest.fn().mockResolvedValue({ id: 'sale-1' });
  const returns = jest.fn().mockResolvedValue({ id: 'return-1' });
  const review = jest.fn().mockResolvedValue({ id: 'review-1' });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [InvoiceController],
      providers: [
        {
          provide: InvoiceService,
          useValue: {
            listMine: mine,
            listAdmin: adminList,
            download,
            verifyDownloadAccess: access,
          },
        },
        {
          provide: SellerInvoiceUploadService,
          useValue: { uploadSale: sale },
        },
        {
          provide: ReturnInvoiceUploadService,
          useValue: { upload: returns },
        },
        {
          provide: AdminInvoiceReviewService,
          useValue: { review },
        },
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
            id: match[1] + '-user',
            role: match[1].toUpperCase(),
            companyId: match[1] + '-company',
          };
          return true;
        },
      })
      .overrideGuard(AdminGuard)
      .useValue({
        canActivate: (context: ExecutionContext) =>
          context.switchToHttp().getRequest().user?.role === 'ADMIN',
      })
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_INVOICE_WRITE;
    delete process.env.ALLOW_LIVE_INVOICE_WRITE;
  });

  it('kimlik doğrulaması olmadan liste ve belge erişimini reddeder', async () => {
    for (const url of [
      '/api/invoices/mine',
      '/api/invoices/admin',
      '/api/invoices/invoice-1/access',
      '/api/invoices/invoice-1/download',
    ]) {
      await request(app.getHttpServer()).get(url).expect(403);
    }
    expect(mine).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('alıcı ve satıcı kendi fatura listesine ulaşır', async () => {
    for (const role of ['buyer', 'seller']) {
      await request(app.getHttpServer())
        .get('/api/invoices/mine')
        .set('Authorization', 'Bearer ' + role)
        .expect(200);
    }
    expect(mine).toHaveBeenCalledTimes(2);
  });

  it('admin listesini alıcıdan korur', async () => {
    await request(app.getHttpServer())
      .get('/api/invoices/admin')
      .set('Authorization', 'Bearer buyer')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/invoices/admin')
      .set('Authorization', 'Bearer admin')
      .expect(200);

    expect(adminList).toHaveBeenCalledTimes(1);
  });

  it('yazma kapalıyken üç POST işlemini engeller', async () => {
    await request(app.getHttpServer())
      .post('/api/invoices/orders/order-1')
      .set('Authorization', 'Bearer seller')
      .expect(503);

    await request(app.getHttpServer())
      .post('/api/invoices/returns/order-1')
      .set('Authorization', 'Bearer buyer')
      .expect(503);

    await request(app.getHttpServer())
      .post('/api/invoices/admin/invoice-1/review')
      .set('Authorization', 'Bearer admin')
      .send({ action: 'APPROVE' })
      .expect(503);

    expect(sale).not.toHaveBeenCalled();
    expect(returns).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it('yazma açıkken satıcı satış faturasını servise iletir', async () => {
    process.env.ENABLE_INVOICE_WRITE = 'true';
    await request(app.getHttpServer())
      .post('/api/invoices/orders/order-1')
      .set('Authorization', 'Bearer seller')
      .field('invoiceNumber', 'TEST-1')
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), {
        filename: 'test.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(sale).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'SELLER' }),
      'order-1',
      expect.objectContaining({ originalname: 'test.pdf' }),
      expect.objectContaining({ invoiceNumber: 'TEST-1' }),
    );
  });

  it('yazma açıkken alıcı iade belgesini servise iletir', async () => {
    process.env.ENABLE_INVOICE_WRITE = 'true';
    await request(app.getHttpServer())
      .post('/api/invoices/returns/order-1')
      .set('Authorization', 'Bearer buyer')
      .field('kind', 'RETURN')
      .field('disputeId', 'dispute-1')
      .attach('file', Buffer.from('%PDF-1.4\n%%EOF'), {
        filename: 'return.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(returns).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'BUYER' }),
      'order-1',
      expect.objectContaining({ originalname: 'return.pdf' }),
      expect.objectContaining({ disputeId: 'dispute-1' }),
    );
  });

  it('admin incelemesi hem rol hem yazma kontrolünden geçer', async () => {
    process.env.ENABLE_INVOICE_WRITE = 'true';

    await request(app.getHttpServer())
      .post('/api/invoices/admin/invoice-1/review')
      .set('Authorization', 'Bearer buyer')
      .send({ action: 'APPROVE' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/invoices/admin/invoice-1/review')
      .set('Authorization', 'Bearer admin')
      .send({ action: 'APPROVE' })
      .expect(201);

    expect(review).toHaveBeenCalledTimes(1);
  });


  it('production ortamında ikinci izin zorunludur', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_INVOICE_WRITE = 'true';

    await request(app.getHttpServer())
      .post('/api/invoices/admin/invoice-1/review')
      .set('Authorization', 'Bearer admin')
      .send({ action: 'APPROVE' })
      .expect(503);

    expect(review).not.toHaveBeenCalled();

    process.env.ALLOW_LIVE_INVOICE_WRITE = 'true';

    await request(app.getHttpServer())
      .post('/api/invoices/admin/invoice-1/review')
      .set('Authorization', 'Bearer admin')
      .send({ action: 'APPROVE' })
      .expect(201);

    expect(review).toHaveBeenCalledTimes(1);
  });

  it('belge erişim ve indirme endpointlerini servise iletir', async () => {
    await request(app.getHttpServer())
      .get('/api/invoices/invoice-1/access')
      .set('Authorization', 'Bearer buyer')
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/invoices/invoice-1/download')
      .set('Authorization', 'Bearer seller')
      .expect(200);

    expect(access).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
