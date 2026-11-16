import { ForbiddenException } from '@nestjs/common';
import { ShippingService } from './shipping.service';

describe('Nakliye açık talepler gizliliği', () => {
  const findMany = jest.fn().mockResolvedValue([]);

  const service = new ShippingService({
    shippingRFQ: { findMany },
  } as any);

  beforeEach(() => jest.clearAllMocks());

  it('yalnızca güvenli alanları ve teklif sayısını döndürür', async () => {
    await service.listOpen({
      role: 'LOGISTICS',
      companyId: 'logistics-1',
    });

    const query = findMany.mock.calls[0][0];

    expect(query.where).toEqual({ status: 'OPEN' });
    expect(query.select._count.select.quotes).toBe(true);

    for (const field of [
      'buyer',
      'seller',
      'quotes',
      'fromAddress',
      'toAddress',
      'fromOpenAddress',
      'toOpenAddress',
      'note',
      'photoUrl',
    ]) {
      expect(query.select).not.toHaveProperty(field);
    }

    expect(
      query.select.order.select.rfq.select.product.select,
    ).toEqual({ title: true });
  });

  it('lojistik rolü dışındaki kullanıcıları reddeder', async () => {
    await expect(
      service.listOpen({ role: 'BUYER', companyId: 'buyer-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.listOpen({ role: 'LOGISTICS' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });
});
