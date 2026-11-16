import { Role } from '@prisma/client';
import { OrderService } from './order.service';

describe('OrderService kargo ve ambar bilgileri gizliliği', () => {
  const findMany = jest.fn();
  const findUnique = jest.fn();

  const order = {
    id: 'shipping-test-order',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status: 'SHIPPED',
    shippingMethod: 'FREIGHT',
    shippingCompany: 'Örnek Ambar',
    shippingTrackingNo: 'AMBAR-123',
    shippingDispatchNo: 'IRS-456',
    shippedAt: new Date('2026-11-01T10:00:00Z'),
    iyzicoCheckoutToken: 'SECRET_TOKEN',
    iyzicoRawResult: 'SECRET_PAYMENT',
    buyer: { id: 'buyer-1' },
    seller: { id: 'seller-1' },
    disputes: [],
  };

  function applySelect(data: any, select: any): any {
    if (data == null) return data;
    if (Array.isArray(data)) {
      return data.map((item) => applySelect(item, select));
    }

    const result: Record<string, any> = {};

    for (const [key, rule] of Object.entries(select)) {
      if (rule === true && key in data) {
        result[key] = data[key];
      } else if (rule && typeof rule === 'object') {
        const nested = (rule as any).select;
        if (nested && key in data) {
          result[key] = applySelect(data[key], nested);
        }
      }
    }

    return result;
  }

  function service() {
    const prisma = {
      order: { findMany, findUnique },
    };

    return new OrderService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  beforeEach(() => {
    jest.resetAllMocks();

    findMany.mockImplementation(async (args: any) =>
      applySelect([order], args.select),
    );

    findUnique.mockImplementation(async (args: any) =>
      applySelect(order, args.select),
    );
  });

  for (const [role, companyId] of [
    [Role.BUYER, 'buyer-1'],
    [Role.SELLER, 'seller-1'],
    [Role.ADMIN, undefined],
  ] as const) {
    it(`${role} gönderim bilgilerini listede görür`, async () => {
      const result = await service().list({ role, companyId });

      expect(result[0]).toMatchObject({
        shippingMethod: 'FREIGHT',
        shippingCompany: 'Örnek Ambar',
        shippingTrackingNo: 'AMBAR-123',
        shippingDispatchNo: 'IRS-456',
      });

      expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
      expect(JSON.stringify(result)).not.toContain('SECRET_PAYMENT');
    });

    it(`${role} gönderim bilgilerini detayda görür`, async () => {
      const result = await service().getOne(
        { role, companyId },
        order.id,
      );

      expect(result).toMatchObject({
        shippingMethod: 'FREIGHT',
        shippingCompany: 'Örnek Ambar',
        shippingTrackingNo: 'AMBAR-123',
        shippingDispatchNo: 'IRS-456',
      });

      expect(result.shippedAt).toBeDefined();
      expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN');
      expect(JSON.stringify(result)).not.toContain('SECRET_PAYMENT');
    });
  }

  it('başka alıcı gönderim detayına erişemez', async () => {
    await expect(
      service().getOne(
        { role: Role.BUYER, companyId: 'other-buyer' },
        order.id,
      ),
    ).rejects.toThrow();
  });

  it('başka satıcı gönderim detayına erişemez', async () => {
    await expect(
      service().getOne(
        { role: Role.SELLER, companyId: 'other-seller' },
        order.id,
      ),
    ).rejects.toThrow();
  });

  it('alıcı listesi kendi şirketiyle sınırlandırılır', async () => {
    await service().list({
      role: Role.BUYER,
      companyId: 'buyer-1',
    });

    expect(findMany.mock.calls[0][0].where).toEqual({
      buyerId: 'buyer-1',
    });
  });

  it('satıcı listesi kendi şirketiyle sınırlandırılır', async () => {
    await service().list({
      role: Role.SELLER,
      companyId: 'seller-1',
    });

    expect(findMany.mock.calls[0][0].where).toEqual({
      sellerId: 'seller-1',
    });
  });
});
