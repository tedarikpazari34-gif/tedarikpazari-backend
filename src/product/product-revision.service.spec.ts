import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ProductRevisionService } from './product-revision.service';

describe('ProductRevisionService security', () => {
  const sellerId = 'seller-1';
  const productId = 'product-1';

  const tx = {
    $queryRaw: jest.fn(),
    product: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    productRevision: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const prisma = {
    $transaction: jest.fn(),
  };

  let service: ProductRevisionService;

  beforeEach(() => {
    jest.clearAllMocks();

    tx.$queryRaw.mockResolvedValue([]);
    tx.product.findUnique.mockResolvedValue({
      id: productId,
      sellerId,
    });
    tx.product.findUniqueOrThrow.mockResolvedValue({
      categoryId: null,
    });
    tx.productRevision.findFirst.mockResolvedValue(null);
    tx.productRevision.create.mockResolvedValue({ id: 'revision-1' });
    tx.productRevision.update.mockResolvedValue({ id: 'revision-1' });

    prisma.$transaction.mockImplementation(async (callback) => callback(tx));

    service = new ProductRevisionService(
      prisma as never,
      {} as never,
    );
  });

  it('başka satıcının ürününe revizyon oluşturulmasını reddeder', async () => {
    tx.product.findUnique.mockResolvedValue({
      id: productId,
      sellerId: 'another-seller',
    });

    await expect(
      service.savePendingRevision(sellerId, productId, {
        title: 'Yeni ürün adı',
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.productRevision.create).not.toHaveBeenCalled();
    expect(tx.productRevision.update).not.toHaveBeenCalled();
  });

  it('bekleyen revizyonun aynı alanını farklı değerle ezmez', async () => {
    tx.productRevision.findFirst.mockResolvedValue({
      id: 'revision-1',
      proposedData: { title: 'İlk başlık' },
    });

    await expect(
      service.savePendingRevision(
        sellerId,
        productId,
        { title: 'İkinci başlık' },
        { rejectPendingConflicts: true },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(tx.productRevision.update).not.toHaveBeenCalled();
  });

  it('çakışmayan alanları bekleyen revizyonla birleştirir', async () => {
    tx.productRevision.findFirst.mockResolvedValue({
      id: 'revision-1',
      proposedData: { title: 'Yeni başlık' },
    });

    await service.savePendingRevision(
      sellerId,
      productId,
      { description: 'Yeni açıklama' },
      { rejectPendingConflicts: true },
    );

    expect(tx.productRevision.update).toHaveBeenCalledWith({
      where: { id: 'revision-1' },
      data: {
        proposedData: {
          title: 'Yeni başlık',
          description: 'Yeni açıklama',
        },
      },
    });
  });

  it('varyant değişikliğini reddeder', async () => {
    await expect(
      service.savePendingRevision(sellerId, productId, {
        variants: [],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
