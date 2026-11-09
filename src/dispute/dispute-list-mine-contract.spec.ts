import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DisputeService } from './dispute.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { IyzicoService } from '../payments/iyzico.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

describe('DisputeService listMine security contract', () => {
  const create = () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 'dispute-1',
      orderId: 'order-1',
      resolution: null,
      resolvedAt: null,
      order: { status: 'PAID' },
      files: [],
    }]);

    const service = new DisputeService(
      { dispute: { findMany } } as unknown as PrismaService,
      {} as NotificationService,
      {} as IyzicoService,
      {} as CloudinaryService,
    );

    return { service, findMany };
  };

  it.each([
    [Role.BUYER, 'buyerId'],
    [Role.SELLER, 'sellerId'],
  ])('%s kendi şirketine göre filtrelenir', async (role, field) => {
    const { service, findMany } = create();
    const result = await service.listMine({
      role,
      companyId: 'company-1',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { [field]: 'company-1' },
        include: expect.objectContaining({
          order: {
            select: expect.objectContaining({ status: true }),
          },
        }),
      }),
    );

    expect(result[0]).toEqual(expect.objectContaining({
      resolution: null,
      resolvedAt: null,
      order: { status: 'PAID' },
    }));
  });

  it.each([Role.BUYER, Role.SELLER])(
    '%s eksik companyId ile sorgu yapamaz',
    async role => {
      const { service, findMany } = create();

      await expect(
        service.listMine({ role, companyId: undefined }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(findMany).not.toHaveBeenCalled();
    },
  );

  it('ADMIN mine endpointinden liste alamaz', async () => {
    const { service, findMany } = create();

    await expect(
      service.listMine({
        role: Role.ADMIN,
        companyId: 'company-admin',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });
});
