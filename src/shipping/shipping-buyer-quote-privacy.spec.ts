import { ForbiddenException } from '@nestjs/common';
import { ShippingService } from './shipping.service';

describe('Alıcı nakliye teklifleri gizliliği', () => {
  const findMany = jest.fn().mockResolvedValue([]);

  const service = new ShippingService({
    shippingQuote: { findMany },
  } as any);

  beforeEach(() => jest.clearAllMocks());

  it('yalnızca kendi tekliflerini ve gerekli alanları seçer', async () => {
    await service.listQuotesForBuyer({
      role: 'BUYER',
      companyId: 'buyer-1',
    });

    const query = findMany.mock.calls[0][0];

    expect(query.where).toEqual({
      rfq: { buyerId: 'buyer-1' },
    });

    expect(query).not.toHaveProperty('include');

    expect(query.select).toEqual({
      id: true,
      status: true,
      price: true,
      deliveryDays: true,
      note: true,
      rfq: {
        select: {
          order: {
            select: {
              rfq: {
                select: {
                  product: {
                    select: { title: true },
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(query.select).not.toHaveProperty('company');
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('firma kimliği olmayan alıcıyı reddeder', async () => {
    await expect(
      service.listQuotesForBuyer({ role: 'BUYER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('başka rolün teklifleri sorgulamasını engeller', async () => {
    await expect(
      service.listQuotesForBuyer({
        role: 'SELLER',
        companyId: 'seller-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });
});
