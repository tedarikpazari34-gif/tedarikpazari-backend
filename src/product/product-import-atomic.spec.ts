import {
  ProductImportRowAction,
  ProductImportSource,
  ProductImportStatus,
  Role,
} from '@prisma/client';
import { ProductImportService } from './product-import.service';

describe('ProductImportService atomic XML processing', () => {
  it('ikinci ürün hata verdiğinde bütün işlemi başarısız sonlandırır', async () => {
    const rows = [1, 2].map((number) => ({
      id: `row-${number}`,
      sku: `SKU-${number}`,
      action: ProductImportRowAction.UPDATE,
      productId: `product-${number}`,
      normalized: {},
      processedAt: null,
      processingToken: null,
    }));

    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      productImportJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'job-1',
          sellerId: 'seller-1',
          source: ProductImportSource.XML,
          status: ProductImportStatus.READY,
          errorRows: 0,
          totalRows: 2,
        }),
        update: jest.fn(),
      },
      productImportRow: {
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany: jest.fn(),
      },
    };

    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };

    const service = new ProductImportService(
      prisma as never,
      {} as never,
      {} as never,
    );

    jest.spyOn(service as any, 'requireVerifiedSellerCompany')
      .mockResolvedValue({ id: 'seller-1' });

    const processRow = jest.spyOn(service as any, 'processImportRow')
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('İkinci ürün hatası'));

    await expect(
      service.processFeedJobAtomically(
        { role: Role.SELLER, companyId: 'seller-1' },
        'job-1',
      ),
    ).rejects.toThrow('İkinci ürün hatası');

    expect(processRow).toHaveBeenCalledTimes(2);
    expect(processRow.mock.calls[0][0]).toBe(tx);
    expect(processRow.mock.calls[1][0]).toBe(tx);
    expect(tx.productImportJob.update).not.toHaveBeenCalled();
    expect(tx.productImportRow.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('101 ürün içeren otomatik XML işlemini reddeder', async () => {
    const tx = {
      $queryRaw: jest.fn(),
      productImportJob: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'job-101', sellerId: 'seller-1',
          source: ProductImportSource.XML,
          status: ProductImportStatus.READY,
          errorRows: 0, totalRows: 101,
        }),
      },
      productImportRow: { findMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const service = new ProductImportService(
      prisma as never, {} as never, {} as never,
    );
    jest.spyOn(service as any, 'requireVerifiedSellerCompany')
      .mockResolvedValue({ id: 'seller-1' });

    await expect(service.processFeedJobAtomically(
      { role: Role.SELLER, companyId: 'seller-1' }, 'job-101',
    )).rejects.toThrow('Otomatik XML için en fazla 100 ürün destekleniyor');

    expect(tx.productImportRow.findMany).not.toHaveBeenCalled();
  });

});
