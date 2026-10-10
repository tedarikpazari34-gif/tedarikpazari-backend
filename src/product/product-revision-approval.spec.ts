import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProductRevisionService } from './product-revision.service';

describe('ProductRevisionService approval security', () => {
  const tx = {
    $queryRaw: jest.fn(),
    productRevision: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    product: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(),
  };

  let service: ProductRevisionService;

  beforeEach(() => {
    jest.resetAllMocks();

    prisma.$transaction.mockImplementation(async (callback) => callback(tx));
    tx.$queryRaw.mockResolvedValue([]);
    tx.productRevision.findUnique.mockResolvedValue({
      productId: 'product-1',
    });
    tx.productRevision.findUniqueOrThrow.mockResolvedValue({
      id: 'revision-1',
      productId: 'product-1',
      sellerId: 'seller-1',
      status: 'PENDING',
      proposedData: { title: 'Yeni ürün adı' },
    });
    tx.product.findUnique.mockResolvedValue({
      id: 'product-1',
      sellerId: 'seller-1',
      isApproved: true,
    });
    tx.product.findUniqueOrThrow.mockResolvedValue({
      categoryId: null,
    });

    service = new ProductRevisionService(prisma as never, {} as never);
  });

  it('satıcının revizyon onaylamasını engeller', async () => {
    await expect(
      service.approveRevision(
        { id: 'seller-user', role: 'SELLER' as never },
        'revision-1',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('sonuçlandırılmış revizyonu yeniden onaylamaz', async () => {
    tx.productRevision.findUniqueOrThrow.mockResolvedValue({
      status: 'APPROVED',
    });

    await expect(
      service.approveRevision(
        { id: 'admin-1', role: 'ADMIN' as never },
        'revision-1',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.product.update).not.toHaveBeenCalled();
    expect(tx.productRevision.update).not.toHaveBeenCalled();
  });

  it('geçerli revizyonu onaylar ve ürünü günceller', async () => {
    tx.product.update.mockResolvedValue({});
    tx.productRevision.update.mockResolvedValue({});

    await expect(
      service.approveRevision(
        { id: 'admin-1', role: 'ADMIN' as never },
        'revision-1',
      ),
    ).resolves.toEqual({
      revisionId: 'revision-1',
      status: 'APPROVED',
    });

    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'product-1' },
      data: { title: 'Yeni ürün adı' },
    });

    expect(tx.productRevision.update).toHaveBeenCalledWith({
      where: { id: 'revision-1' },
      data: {
        status: 'APPROVED',
        reviewedById: 'admin-1',
        reviewedAt: expect.any(Date),
        rejectionReason: null,
      },
    });
  });
});
