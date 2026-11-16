import { ForbiddenException } from '@nestjs/common';
import { ShippingService } from './shipping.service';

describe('Nakliye durum güncelleme gizliliği', () => {
  const findUnique = jest.fn();
  const update = jest.fn();

  const service = new ShippingService({
    shippingOrder: { findUnique, update },
  } as any);

  beforeEach(() => {
    jest.resetAllMocks();
    update.mockResolvedValue({ id: 'shipping-1' });
  });

  const scenarios = [
    ['pickup', 'PENDING_PICKUP', 'PICKED_UP', 'pickedUpAt'],
    ['transit', 'PICKED_UP', 'IN_TRANSIT', 'shippedAt'],
    ['deliver', 'IN_TRANSIT', 'DELIVERED', 'deliveredAt'],
  ];

  it.each(scenarios)(
    '%s işleminde yalnızca güvenli alanları döndürür',
    async (method, before, after, dateField) => {
      findUnique.mockResolvedValue({
        logisticsId: 'logistics-1',
        status: before,
      });

      await (service as any)[method](
        { role: 'LOGISTICS', companyId: 'logistics-1' },
        'shipping-1',
      );

      expect(findUnique).toHaveBeenCalledWith({
        where: { id: 'shipping-1' },
        select: {
          logisticsId: true,
          status: true,
        },
      });

      const query = update.mock.calls[0][0];

      expect(query.data.status).toBe(after);
      expect(query.data[dateField]).toBeInstanceOf(Date);

      expect(query.select).toEqual({
        id: true,
        status: true,
        trackingNo: true,
        pickedUpAt: true,
        shippedAt: true,
        deliveredAt: true,
      });

      expect(query.select).not.toHaveProperty('shippingCompany');
    },
  );

  it.each(['pickup', 'transit', 'deliver'])(
    '%s işleminde firma kimliği olmayan kullanıcıyı reddeder',
    async (method) => {
      await expect(
        (service as any)[method]({ role: 'LOGISTICS' }, 'shipping-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(findUnique).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each(['pickup', 'transit', 'deliver'])(
    '%s işleminde başka lojistik firmasını reddeder',
    async (method) => {
      findUnique.mockResolvedValue({
        logisticsId: 'logistics-1',
        status: 'PENDING_PICKUP',
      });

      await expect(
        (service as any)[method](
          { role: 'LOGISTICS', companyId: 'other-logistics' },
          'shipping-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(update).not.toHaveBeenCalled();
    },
  );
});
