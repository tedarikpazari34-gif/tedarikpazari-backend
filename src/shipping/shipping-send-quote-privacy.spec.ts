import { ForbiddenException } from '@nestjs/common';
import { ShippingService } from './shipping.service';

describe('Nakliye teklif gönderme gizliliği', () => {
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const create = jest.fn();

  const lock = jest.fn();
  const tx = {
    $queryRaw: lock,
    shippingRFQ: { findUnique },
    shippingQuote: { findFirst, create },
  };
  const transaction = jest.fn();
  const service = new ShippingService({
    $transaction: transaction,
  } as any);

  beforeEach(() => {
    jest.resetAllMocks();
    lock.mockResolvedValue([{ id: 'rfq-1' }]);
    transaction.mockImplementation(async (fn: any) => fn(tx));
    findUnique.mockResolvedValue({ status: 'OPEN' });
    findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'quote-1', status: 'SENT' });
  });

  it('teklif yanıtında özel firma ve adres bilgilerini seçmez', async () => {
    await service.sendQuote(
      { role: 'LOGISTICS', companyId: 'logistics-1' },
      { rfqId: 'rfq-1', price: 1500, deliveryDays: 2 },
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'rfq-1' },
      select: { status: true },
    });

    const query = create.mock.calls[0][0];

    expect(query.select).toEqual({
      id: true,
      status: true,
    });
    expect(query).not.toHaveProperty('include');
    expect(query.data.companyId).toBe('logistics-1');
  });

  it('firma kimliği olmayan lojistik kullanıcısını reddeder', async () => {
    await expect(
      service.sendQuote(
        { role: 'LOGISTICS' },
        { rfqId: 'rfq-1', price: 1500, deliveryDays: 2 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(create).not.toHaveBeenCalled();
  });

  it('aynı firmanın ikinci teklifini engeller', async () => {
    findFirst.mockResolvedValue({ id: 'existing-quote' });

    await expect(
      service.sendQuote(
        { role: 'LOGISTICS', companyId: 'logistics-1' },
        { rfqId: 'rfq-1', price: 1500, deliveryDays: 2 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(create).not.toHaveBeenCalled();
  });

  it('tekliften önce parametreli PostgreSQL satır kilidi alır', async () => {
    await service.sendQuote(
      { role: 'LOGISTICS', companyId: 'logistics-1' },
      { rfqId: 'rfq-1', price: 1500, deliveryDays: 2 },
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(lock).toHaveBeenCalledTimes(1);

    const [sql, rfqId] = lock.mock.calls[0];
    expect(sql.join(' ')).toMatch(/FOR UPDATE/i);
    expect(sql.join(' ')).toContain('ShippingRFQ');
    expect(rfqId).toBe('rfq-1');

    expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
      findFirst.mock.invocationCallOrder[0],
    );
  });

  it('eşzamanlı tekliflerde yalnızca birini kabul eder (kilit simülasyonu)', async () => {
    let previous = Promise.resolve();
    let hasQuote = false;
    let created = 0;

    transaction.mockImplementation(async (fn: any) => {
      let release: () => void = () => {};

      const localTx = {
        $queryRaw: jest.fn(async () => {
          const wait = previous;
          previous = new Promise<void>((resolve) => {
            release = resolve;
          });
          await wait;
          return [{ id: 'rfq-1' }];
        }),
        shippingRFQ: {
          findUnique: jest.fn().mockResolvedValue({ status: 'OPEN' }),
        },
        shippingQuote: {
          findFirst: jest.fn(async () =>
            hasQuote ? { id: 'quote-1' } : null,
          ),
          create: jest.fn(async () => {
            created++;
            hasQuote = true;
            return { id: 'quote-1', status: 'SENT' };
          }),
        },
      };

      try {
        return await fn(localTx);
      } finally {
        release();
      }
    });

    const user = { role: 'LOGISTICS', companyId: 'logistics-1' };
    const body = { rfqId: 'rfq-1', price: 1500, deliveryDays: 2 };

    const results = await Promise.allSettled([
      service.sendQuote(user, body),
      service.sendQuote(user, body),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(created).toBe(1);
  });
});
