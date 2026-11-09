import { InvoiceService } from './invoice.service';

describe('Private invoice download security', () => {
  const record = {
    id: 'invoice1',
    orderId: 'order1',
    buyerId: 'buyer1',
    sellerId: 'seller1',
    status: 'RECORDED',
    fileMimeType: 'application/pdf',
    storagePublicId: 'tedarik-pazari-platform/invoices/file1',
    storageResourceType: 'raw',
    storageDeliveryType: 'authenticated',
  };

  const findUnique = jest.fn();
  const createDownloadUrl = jest.fn();

  const service = new InvoiceService(
    { invoiceRecord: { findUnique } } as any,
    { createDownloadUrl } as any,
  );

  beforeEach(() => {
    findUnique.mockReset();
    createDownloadUrl.mockReset();
    findUnique.mockResolvedValue(record);
    createDownloadUrl.mockReturnValue({
      url: 'https://example.com/signed-invoice',
      expiresAt: '2026-10-30T23:00:00.000Z',
    });
  });

  it('buyer downloads only their own invoice', async () => {
    const result = await service.download(
      { role: 'BUYER', companyId: 'buyer1' },
      'invoice1',
    );

    expect(result.invoiceId).toBe('invoice1');
    expect(result.url).toContain('https://');
    expect(result).not.toHaveProperty('storagePublicId');
    expect(createDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'raw',
        deliveryType: 'authenticated',
      }),
      'pdf',
    );
  });

  it('another company cannot generate a download link', async () => {
    await expect(
      service.download(
        { role: 'BUYER', companyId: 'other-buyer' },
        'invoice1',
      ),
    ).rejects.toThrow('Fatura bulunamadı');

    expect(createDownloadUrl).not.toHaveBeenCalled();
  });

  it('seller can download the invoice of their sale', async () => {
    await service.download(
      { role: 'SELLER', companyId: 'seller1' },
      'invoice1',
    );

    expect(createDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it('admin can inspect invoice documents', async () => {
    await service.download({ role: 'ADMIN' }, 'invoice1');

    expect(createDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it('rejects public or unsafe storage references', async () => {
    findUnique.mockResolvedValue({
      ...record,
      storageDeliveryType: 'upload',
    });

    await expect(
      service.download(
        { role: 'BUYER', companyId: 'buyer1' },
        'invoice1',
      ),
    ).rejects.toThrow();

    expect(createDownloadUrl).not.toHaveBeenCalled();
  });

  it('rejects another document folder', async () => {
    findUnique.mockResolvedValue({
      ...record,
      storagePublicId: 'other-folder/file1',
    });

    await expect(
      service.download({ role: 'ADMIN' }, 'invoice1'),
    ).rejects.toThrow();

    expect(createDownloadUrl).not.toHaveBeenCalled();
  });
});
