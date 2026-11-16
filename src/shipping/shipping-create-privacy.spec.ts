import { ForbiddenException } from '@nestjs/common';
import { ShippingService } from './shipping.service';

describe('Nakliye talebi oluşturma gizliliği', () => {
  const orderFindUnique = jest.fn();
  const rfqFindFirst = jest.fn();
  const rfqCreate = jest.fn();

  const lock = jest.fn();
  const transaction = jest.fn();
  const tx = {
    $queryRaw: lock,
    shippingRFQ: {
      findFirst: rfqFindFirst,
      create: rfqCreate,
    },
  };

  const service = new ShippingService({
    order: { findUnique: orderFindUnique },
    $transaction: transaction,
  } as any);

  const body = {
    orderId: 'order-1',
    fromCity: 'İstanbul',
    fromDistrict: 'Bağcılar',
    fromOpenAddress: 'Yükleme adresi',
    toCity: 'Ankara',
    toDistrict: 'Çankaya',
    toOpenAddress: 'Teslimat adresi',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    lock.mockResolvedValue([{ id: 'order-1' }]);
    transaction.mockImplementation(async (fn: any) => fn(tx));

    orderFindUnique.mockResolvedValue({
      buyerId: 'buyer-1',
    });

    rfqFindFirst.mockResolvedValue(null);

    rfqCreate.mockResolvedValue({
      id: 'shipping-rfq-1',
      orderId: 'order-1',
      status: 'OPEN',
    });
  });

  it('siparişten yalnızca sahiplik bilgisini okur', async () => {
    await service.createRFQ(
      { role: 'BUYER', companyId: 'buyer-1' },
      body,
    );

    expect(orderFindUnique).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      select: { buyerId: true },
    });
  });

  it('açık adresleri kaydeder ancak API yanıtında seçmez', async () => {
    await service.createRFQ(
      { role: 'BUYER', companyId: 'buyer-1' },
      body,
    );

    const query = rfqCreate.mock.calls[0][0];

    expect(query.data.buyerId).toBe('buyer-1');
    expect(query.data.orderId).toBe('order-1');
    expect(query.data.fromOpenAddress).toBe('Yükleme adresi');
    expect(query.data.toOpenAddress).toBe('Teslimat adresi');

    expect(query.select).toEqual({
      id: true,
      orderId: true,
      status: true,
      createdAt: true,
    });

    expect(query).not.toHaveProperty('include');
    expect(query.select).not.toHaveProperty('buyer');
    expect(query.select).not.toHaveProperty('order');
    expect(query.select).not.toHaveProperty('fromAddress');
    expect(query.select).not.toHaveProperty('toAddress');
  });

  it('firma kimliği olmayan alıcıyı reddeder', async () => {
    await expect(
      service.createRFQ({ role: 'BUYER' }, body),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(rfqCreate).not.toHaveBeenCalled();
  });

  it('başkasının siparişi için talep oluşturmayı engeller', async () => {
    await expect(
      service.createRFQ(
        { role: 'BUYER', companyId: 'other-buyer' },
        body,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(rfqCreate).not.toHaveBeenCalled();
  });

  it('aynı siparişi kilitleyerek çift talebi engeller', async () => {
    await service.createRFQ(
      { role: 'BUYER', companyId: 'buyer-1' },
      body,
    );

    const [sql, orderId] = lock.mock.calls[0];
    expect(sql.join(' ')).toContain('"Order"');
    expect(sql.join(' ')).toMatch(/FOR UPDATE/i);
    expect(orderId).toBe('order-1');
    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      rfqFindFirst.mock.invocationCallOrder[0],
    );
  });

  it('eşzamanlı iki talepte yalnızca birini oluşturur (simülasyon)', async () => {
    let previous = Promise.resolve();
    let created = false;
    let createCount = 0;

    transaction.mockImplementation(async (fn: any) => {
      let release: () => void = () => {};

      const localTx = {
        $queryRaw: jest.fn(async () => {
          const wait = previous;
          previous = new Promise<void>((resolve) => {
            release = resolve;
          });
          await wait;
          return [{ id: 'order-1' }];
        }),
        shippingRFQ: {
          findFirst: jest.fn(async () =>
            created ? { id: 'shipping-rfq-1' } : null,
          ),
          create: jest.fn(async () => {
            created = true;
            createCount++;
            return { id: 'shipping-rfq-1', status: 'OPEN' };
          }),
        },
      };

      try {
        return await fn(localTx);
      } finally {
        release();
      }
    });

    const user = { role: 'BUYER', companyId: 'buyer-1' };

    const results = await Promise.allSettled([
      service.createRFQ(user, body),
      service.createRFQ(user, body),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(createCount).toBe(1);
  });
});
