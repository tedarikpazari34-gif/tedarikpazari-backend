import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ProductService } from './product.service';
import { ProductRevisionService } from './product-revision.service';
import { AdminService } from '../admin/admin.service';

describe('Arsivlenen urun onay guvenligi', () => {
  it('normal urun onayi arsivlenmis urunu reddeder', async () => {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          archivedAt: new Date(),
        }),
        update: jest.fn(),
      },
    };

    const service = Object.create(ProductService.prototype) as ProductService;
    (service as any).prisma = prisma;

    await expect(
      service.approve({ role: Role.ADMIN }, 'product-1'),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('admin paneli arsivlenmis urunu onaylayamaz', async () => {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          archivedAt: new Date(),
        }),
        update: jest.fn(),
      },
    };

    const service = Object.create(AdminService.prototype) as AdminService;
    (service as any).prisma = prisma;

    await expect(
      service.approveProduct('product-1'),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('admin onayinda arsiv filtresi guncelleme aninda da kullanilir', async () => {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          archivedAt: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'product-1' }),
      },
    };

    const service = Object.create(AdminService.prototype) as AdminService;
    (service as any).prisma = prisma;

    await service.approveProduct('product-1');

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'product-1',
          archivedAt: null,
        },
      }),
    );
  });

  it('normal onayda arsiv filtresi guncelleme aninda da kullanilir', async () => {
    const prisma = {
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          archivedAt: null,
        }),
        update: jest.fn().mockResolvedValue({ id: 'product-1' }),
      },
    };

    const service = Object.create(ProductService.prototype) as ProductService;
    (service as any).prisma = prisma;

    await service.approve({ role: Role.ADMIN }, 'product-1');

    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'product-1',
          archivedAt: null,
        },
      }),
    );
  });

  it('bekleyen revizyon arsivlenen urune uygulanamaz', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'product-1' }]),
      productRevision: {
        findUnique: jest.fn().mockResolvedValue({
          productId: 'product-1',
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'revision-1',
          productId: 'product-1',
          sellerId: 'seller-1',
          status: 'PENDING',
        }),
      },
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'product-1',
          sellerId: 'seller-1',
          isApproved: true,
          archivedAt: new Date(),
        }),
        update: jest.fn(),
      },
    };

    const prisma = {
      $transaction: jest.fn(
        async (callback: (tx: any) => Promise<any>) => callback(tx),
      ),
    };

    const service = Object.create(
      ProductRevisionService.prototype,
    ) as ProductRevisionService;

    (service as any).prisma = prisma;

    await expect(
      service.approveRevision(
        { id: 'admin-1', role: Role.ADMIN },
        'revision-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
