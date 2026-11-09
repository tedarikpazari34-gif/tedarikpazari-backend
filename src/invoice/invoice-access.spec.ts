import { InvoiceService } from './invoice.service';

describe('Invoice access by buyer, seller and admin', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const findUnique = jest.fn();

  const service = new InvoiceService(
    { invoiceRecord: { findMany, findUnique } } as any,
    { createDownloadUrl: jest.fn() } as any,
  );

  beforeEach(() => {
    findMany.mockClear();
    findUnique.mockReset();
  });

  it('buyer sees only own purchase invoices', async () => {
    await service.listMine({
      role: 'BUYER',
      companyId: 'buyer1',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          buyerId: 'buyer1',
          OR: [
            { status: 'RECORDED' },
            { issuerCompanyId: 'buyer1' },
          ],
        },
      }),
    );
  });

  it('seller sees only own sales invoices', async () => {
    await service.listMine({
      role: 'SELLER',
      companyId: 'seller1',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sellerId: 'seller1',
          OR: [
            { status: 'RECORDED' },
            { issuerCompanyId: 'seller1' },
          ],
        },
      }),
    );
  });

  it('admin can list audit records', async () => {
    await service.listAdmin({ role: 'ADMIN' });

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('buyer cannot use admin invoice listing', async () => {
    await expect(
      service.listAdmin({
        role: 'BUYER',
        companyId: 'buyer1',
      }),
    ).rejects.toThrow();

    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects access to another company invoice', async () => {
    findUnique.mockResolvedValue({
      id: 'inv1',
      orderId: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'RECORDED',
      fileMimeType: 'application/pdf',
      storagePublicId:
        'tedarik-pazari-platform/invoices/example_pdf',
      storageResourceType: 'raw',
      storageDeliveryType: 'authenticated',
    });

    await expect(
      service.verifyDownloadAccess(
        { role: 'BUYER', companyId: 'buyer2' },
        'inv1',
      ),
    ).rejects.toThrow('Fatura bulunamadı');
  });

  it('allows the actual buyer to access invoice', async () => {
    findUnique.mockResolvedValue({
      id: 'inv1',
      orderId: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'RECORDED',
      fileMimeType: 'application/pdf',
      storagePublicId:
        'tedarik-pazari-platform/invoices/example_pdf',
      storageResourceType: 'raw',
      storageDeliveryType: 'authenticated',
    });

    const result = await service.verifyDownloadAccess(
      { role: 'BUYER', companyId: 'buyer1' },
      'inv1',
    );

    expect(result).toEqual({
      invoiceId: 'inv1',
      authorized: true,
    });
  });

  it('rejects unsupported roles', async () => {
    await expect(
      service.listMine({
        role: 'LOGISTICS',
        companyId: 'company1',
      }),
    ).rejects.toThrow();

    expect(findMany).not.toHaveBeenCalled();
  });

  it('never includes storage references in invoice lists', async () => {
    await service.listMine({
      role: 'BUYER',
      companyId: 'buyer1',
    });

    const options = findMany.mock.calls[0][0];

    expect(options.select.storagePublicId).toBeUndefined();
    expect(options.select.storageDeliveryType).toBeUndefined();
  });

  it('rejects invalid invoice storage references', async () => {
    for (const publicId of [
      null,
      '',
      'tedarik-pazari-platform/products/product-1',
      'tedarik-pazari-platform/invoices/',
      'tedarik-pazari-platform/invoices/../products/file-1',
      'tedarik-pazari-platform/invoices/file.pdf',
    ]) {
      findUnique.mockResolvedValue({
        id: 'inv1',
        orderId: 'order1',
        buyerId: 'buyer1',
        sellerId: 'seller1',
        issuerCompanyId: 'seller1',
        status: 'RECORDED',
        fileMimeType: 'application/pdf',
        storagePublicId: publicId,
        storageResourceType: 'raw',
        storageDeliveryType: 'authenticated',
      });

      await expect(
        service.verifyDownloadAccess(
          { role: 'BUYER', companyId: 'buyer1' },
          'inv1',
        ),
      ).rejects.toThrow();
    }
  });
});
