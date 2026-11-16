import { ForbiddenException } from '@nestjs/common';
import { ShippingService } from './shipping.service';

describe('Nakliye siparişleri gizliliği', () => {
  const findMany = jest.fn().mockResolvedValue([]);

  const service = new ShippingService({
    shippingOrder: { findMany },
  } as any);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['LOGISTICS', 'logisticsId'],
    ['BUYER', 'buyerId'],
    ['SELLER', 'sellerId'],
  ])('%s yalnızca kendi siparişlerini görür', async (role, field) => {
    await service.listShippingOrders({
      role,
      companyId: 'company-1',
    });

    const query = findMany.mock.calls[0][0];

    expect(query.where).toEqual({
      [field]: 'company-1',
    });

    for (const privateField of [
      'buyer',
      'seller',
      'logistics',
      'shippingCompany',
    ]) {
      expect(query.select).not.toHaveProperty(privateField);
    }

    expect(query.select.order.select).not.toHaveProperty('buyer');
    expect(query.select.order.select).not.toHaveProperty('seller');

    expect(query.select.shippingRfq.select.fromAddress).toBe(
      role === 'LOGISTICS' || role === 'SELLER',
    );
    expect(query.select.shippingRfq.select.toAddress).toBe(
      role === 'LOGISTICS' || role === 'BUYER',
    );

    expect(
      query.select.order.select.rfq.select.product.select,
    ).toEqual({ title: true });

    expect(query.select.shippingQuote.select).toEqual({
      id: true,
      price: true,
      deliveryDays: true,
    });
  });

  it('firma kimliği eksik kullanıcıyı reddeder', async () => {
    await expect(
      service.listShippingOrders({ role: 'LOGISTICS' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('yetkisiz rolü reddeder', async () => {
    await expect(
      service.listShippingOrders({
        role: 'ADMIN',
        companyId: 'company-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });
});
