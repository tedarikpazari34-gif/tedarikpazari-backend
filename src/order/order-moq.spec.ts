import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { OrderService } from './order.service';

describe('OrderService - MOQ katları', () => {
  const setup = (moq: number) => {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          sellerId: 'seller-1',
          seller: { id: 'seller-1' },
          isActive: true,
          isApproved: true,
          variants: [],
          stockQuantity: 1000,
          moq,
          unitType: 'ADET',
          basePrice: 90,
          vatRate: 20,
        }),
      },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'order-1' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };

    const service = new OrderService(
      prisma as any,
      { createNotification: jest.fn() } as any,
      {} as any,
      {} as any,
    );

    return { service, prisma };
  };

  const buyer = {
    role: Role.BUYER,
    companyId: 'buyer-1',
  };

  it.each([
    [2, 2], [2, 4], [2, 6],
    [3, 3], [3, 6], [3, 9],
    [5, 5], [5, 10], [5, 15],
  ])('MOQ %i için %i adet siparişi kabul eder', async (moq, quantity) => {
    const { service, prisma } = setup(moq);

    await service.createDirect(
      buyer,
      { productId: 'product-1', quantity } as any,
    );

    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(prisma.order.create.mock.calls[0][0].data.quantity).toBe(quantity);
  });

  it.each([
    [2, 3], [2, 5],
    [3, 4], [3, 5],
    [5, 6], [5, 7],
    [3, 2], [5, 0],
    [3, 4.5],
  ])('MOQ %i için %i adet siparişi reddeder', async (moq, quantity) => {
    const { service, prisma } = setup(moq);

    await expect(
      service.createDirect(
        buyer,
        { productId: 'product-1', quantity } as any,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});
