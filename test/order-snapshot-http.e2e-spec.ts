import { Test } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { Role, Prisma } from '@prisma/client';
import request = require('supertest');
import { randomUUID } from 'crypto';

import { PrismaService } from '../src/prisma/prisma.service';
import { OrderController } from '../src/order/order.controller';
import { OrderService } from '../src/order/order.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { NotificationService } from '../src/notification/notification.service';
import { MailService } from '../src/mail/mail.service';
import { IyzicoService } from '../src/payments/iyzico.service';

jest.setTimeout(30000);

describe('Isolated order snapshot HTTP E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let buyer: any;
  let otherBuyer: any;
  let seller: any;
  let admin: any;

  let productId: string | null = null;
  let variantId: string | null = null;
  let orderId: string | null = null;

  const notification = jest.fn().mockResolvedValue({
    id: 'isolated-notification',
  });

  const token = (user: any) => {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 64) {
      throw new Error('Test JWT secret missing');
    }

    return new JwtService({
      secret,
    }).sign(
      { sub: user.id },
      { expiresIn: '5m' },
    );
  };

  const counts = async () => {
    const [
      orders,
      payments,
      invoices,
      disputes,
      products,
      variants,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.paymentTransaction.count(),
      prisma.invoiceRecord.count(),
      prisma.dispute.count(),
      prisma.product.count(),
      prisma.productVariant.count(),
    ]);

    return [
      orders,
      payments,
      invoices,
      disputes,
      products,
      variants,
    ].join('|');
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [OrderController],
      providers: [
        PrismaService,
        OrderService,
        JwtStrategy,
        {
          provide: NotificationService,
          useValue: {
            createNotification: notification,
          },
        },
        {
          provide: MailService,
          useValue: {},
        },
        {
          provide: IyzicoService,
          useValue: {},
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await app.init();
    prisma = module.get(PrismaService);

    const identity = await prisma.$queryRaw<Array<{
      database_name: string;
      user_name: string;
      port_name: string;
      server_address: string | null;
    }>>`
      SELECT
        current_database() AS database_name,
        current_user AS user_name,
        current_setting('port') AS port_name,
        inet_server_addr()::text AS server_address
    `;

    const db = identity[0];

    if (
      db?.database_name !== 'nex_invoice_migration_test' ||
      db?.user_name !== 'nex_invoice_test' ||
      db?.port_name !== '55491' ||
      db?.server_address !== null
    ) {
      throw new Error('Isolated database identity mismatch');
    }

    if ((await counts()) !== '4|3|10|2|0|0') {
      throw new Error('Unexpected initial test database counts');
    }

    const users = await prisma.user.findMany({
      include: { company: true },
    });

    const eligible = (role: Role) =>
      users.filter(
        (user) =>
          user.role === role &&
          user.company?.role === role &&
          user.company?.status === 'APPROVED' &&
          user.company?.verified === true,
      );

    buyer = eligible(Role.BUYER)[0];
    seller = eligible(Role.SELLER)[0];
    admin = eligible(Role.ADMIN)[0];

    if (!buyer || !seller || !admin) {
      throw new Error('Required approved test roles are missing');
    }

    otherBuyer = eligible(Role.BUYER).find(
      (user) => user.companyId !== buyer.companyId,
    );

    const unique = randomUUID().replace(/-/g, '');

    const product = await prisma.product.create({
      data: {
        sellerId: seller.companyId,
        title: '2358 Orijinal Test Urunu',
        sku: `NEX-2358-${unique}`,
        unitType: 'ADET',
        moq: 12,
        quantityStep: 7,
        basePrice: new Prisma.Decimal('90.25'),
        stockQuantity: 100,
        vatRate: 20,
        isActive: true,
        isApproved: true,
      },
    });

    productId = product.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId: product.id,
        name: '2358 Test Varyanti',
        sku: `V-2358-${unique}`,
        barcode: '8690000000001',
        price: new Prisma.Decimal('120'),
        stockQuantity: 100,
        isActive: true,
      },
    });

    variantId = variant.id;
  });

  afterAll(async () => {
    try {
      if (prisma && productId) {
        await prisma.order.deleteMany({
          where: { productId },
        });

        await prisma.productVariant.deleteMany({
          where: { productId },
        });

        await prisma.product.deleteMany({
          where: { id: productId },
        });
      }

      if (prisma) {
        const finalCounts = await counts();

        console.log('2358 SON KAYITLAR |', finalCounts);

        expect(finalCounts).toBe('4|3|10|2|0|0');

        console.log('2358 TEMIZLIK | PASS');
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it('anonymous order creation is rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/orders/direct')
      .send({
        productId,
        variantId,
        quantity: 24,
      })
      .expect(401);
  });

  it('seller cannot create a buyer order', async () => {
    await request(app.getHttpServer())
      .post('/api/orders/direct')
      .set('Authorization', `Bearer ${token(seller)}`)
      .send({
        productId,
        variantId,
        quantity: 24,
      })
      .expect(403);
  });

  it('a product with variants requires a variant choice', async () => {
    await request(app.getHttpServer())
      .post('/api/orders/direct')
      .set('Authorization', `Bearer ${token(buyer)}`)
      .send({
        productId,
        quantity: 24,
      })
      .expect(400);
  });

  it('invalid MOQ quantity is rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/orders/direct')
      .set('Authorization', `Bearer ${token(buyer)}`)
      .send({
        productId,
        variantId,
        quantity: 13,
      })
      .expect(400);
  });

  it('outdated expected price is rejected', async () => {
    await request(app.getHttpServer())
      .post('/api/orders/direct')
      .set('Authorization', `Bearer ${token(buyer)}`)
      .send({
        productId,
        variantId,
        quantity: 24,
        expectedTotalAmount: '2800.00',
      })
      .expect(400);
  });

  it('buyer creates an order with purchase snapshots', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/orders/direct')
      .set('Authorization', `Bearer ${token(buyer)}`)
      .send({
        productId,
        variantId,
        quantity: 24,
        expectedTotalAmount: '2880.00',
      })
      .expect(201);

    const order = response.body.order;

    expect(order?.id).toBeTruthy();
    orderId = order.id;

    expect(order.productTitleSnapshot)
      .toBe('2358 Orijinal Test Urunu');

    expect(order.productSkuSnapshot)
      .toMatch(/^NEX-2358-/);

    expect(order.unitTypeSnapshot).toBe('ADET');
    expect(order.variantName).toBe('2358 Test Varyanti');
    expect(order.variantSku).toMatch(/^V-2358-/);
    expect(String(order.unitPriceSnapshot)).toBe('120');
    expect(String(order.totalAmount)).toBe('2880');
    expect(order.stockReservationStatus).toBe('RESERVED');
    expect(order.status).toBe('PENDING_PAYMENT');
  });

  it('reserves only the chosen variant stock', async () => {
    expect(orderId).toBeTruthy();
    expect(variantId).toBeTruthy();
    expect(productId).toBeTruthy();

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId! },
    });

    const product = await prisma.product.findUniqueOrThrow({
      where: { id: productId! },
    });

    expect(variant.reservedQuantity).toBe(24);
    expect(product.reservedQuantity).toBe(0);

    expect(notification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ORDER',
        link: '/seller/orders',
      }),
    );
  });

  it('prevents overselling the remaining variant stock', async () => {
    await request(app.getHttpServer())
      .post('/api/orders/direct')
      .set('Authorization', `Bearer ${token(buyer)}`)
      .send({
        productId,
        variantId,
        quantity: 84,
      })
      .expect(400);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId! },
    });

    expect(variant.reservedQuantity).toBe(24);
  });

  it('buyer seller and admin can read the order', async () => {
    expect(orderId).toBeTruthy();

    for (const user of [buyer, seller, admin]) {
      const response = await request(app.getHttpServer())
        .get(`/api/orders/${orderId}`)
        .set('Authorization', `Bearer ${token(user)}`)
        .expect(200);

      expect(response.body.productTitleSnapshot)
        .toBe('2358 Orijinal Test Urunu');

      expect(response.body.variantName)
        .toBe('2358 Test Varyanti');

      expect(String(response.body.unitPriceSnapshot))
        .toBe('120');
    }
  });

  it('unrelated buyer cannot access the order when available', async () => {
    if (!otherBuyer) {
      console.log(
        '2358 NOT | Farkli sirketten ikinci BUYER yok; ' +
        'bu yetki senaryosu ayrica test edilmeli.',
      );
      return;
    }

    await request(app.getHttpServer())
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${token(otherBuyer)}`)
      .expect(403);
  });

  it('product updates do not rewrite old order snapshots', async () => {
    await prisma.product.update({
      where: { id: productId! },
      data: {
        title: '2358 XML Sonrasi Yeni Urun Adi',
        sku: `UPDATED-2358-${randomUUID()}`,
        basePrice: new Prisma.Decimal('150'),
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${token(buyer)}`)
      .expect(200);

    expect(response.body.product?.title)
      .toBe('2358 XML Sonrasi Yeni Urun Adi');

    expect(response.body.productTitleSnapshot)
      .toBe('2358 Orijinal Test Urunu');

    expect(String(response.body.unitPriceSnapshot)).toBe('120');
    expect(String(response.body.totalAmount)).toBe('2880');
  });
});
