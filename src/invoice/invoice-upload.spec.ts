import { SellerInvoiceUploadService } from './invoice-upload.service';

describe('Seller invoice upload safety', () => {
  const order = {
    id: 'order1',
    buyerId: 'buyer1',
    sellerId: 'seller1',
    status: 'PAID',
    netAmount: '100',
    vatAmount: '20',
    totalAmount: '120',
    iyzicoPaidAt: new Date(),
    iyzicoPaymentTransactionId: 'txn1',
  };

  const tx = {
    company: { findUnique: jest.fn() },
    order: { findUnique: jest.fn() },
    paymentTransaction: { findUnique: jest.fn() },
    invoiceRecord: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  const storage = {
    upload: jest.fn(),
    remove: jest.fn(),
  };

  const notifier = {
    stage: jest.fn().mockResolvedValue([]),
    publish: jest.fn(),
  };

  const service = new SellerInvoiceUploadService(
    prisma as any, storage as any, notifier as any,
  );

  const seller = {
    id: 'user1',
    role: 'SELLER',
    companyId: 'seller1',
  };

  const pdf = {
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\nendobj\n%%EOF'),
    mimetype: 'application/pdf',
  } as any;

  const body = {
    invoiceNumber: 'ABC2026000000001',
    channel: 'E_ARCHIVE',
    issuedAt: '2026-10-30',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.company.findUnique.mockResolvedValue({
      status: 'APPROVED', verified: true,
    });
    tx.order.findUnique.mockResolvedValue(order);
    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: null,
      iyzicoRefundedAt: null,
    });
    tx.invoiceRecord.findFirst.mockResolvedValue(null);
    tx.invoiceRecord.findMany.mockResolvedValue([]);
    tx.invoiceRecord.create.mockResolvedValue({
      id: 'invoice1', status: 'PENDING_REVIEW',
    });
    storage.upload.mockResolvedValue({
      publicId: 'tedarik-pazari-platform/invoices/file1',
      resourceType: 'raw',
      deliveryType: 'authenticated',
    });
    storage.remove.mockResolvedValue(undefined);
  });

  it('rejects buyer uploads', async () => {
    await expect(
      service.uploadSale(
        { ...seller, role: 'BUYER' }, 'order1', pdf, body,
      ),
    ).rejects.toThrow();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects another seller order', async () => {
    tx.order.findUnique.mockResolvedValue({
      ...order, sellerId: 'another-seller',
    });
    await expect(
      service.uploadSale(seller, 'order1', pdf, body),
    ).rejects.toThrow();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects invalid PDF files', async () => {
    await expect(
      service.uploadSale(
        seller, 'order1',
        { buffer: Buffer.from('not pdf'), mimetype: 'text/plain' } as any,
        body,
      ),
    ).rejects.toThrow();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects unsuccessful payments', async () => {
    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      status: 'FAILED',
    });
    await expect(
      service.uploadSale(seller, 'order1', pdf, body),
    ).rejects.toThrow();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('creates only a pending-review record', async () => {
    const result = await service.uploadSale(
      seller, 'order1', pdf, body,
    );
    expect(result.status).toBe('PENDING_REVIEW');
    expect(notifier.stage).toHaveBeenCalledWith(
      expect.anything(),
      'ADMIN',
      null,
      expect.objectContaining({ link: '/admin/finance' }),
    );
    expect(tx.invoiceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buyerId: 'buyer1',
          sellerId: 'seller1',
          status: 'PENDING_REVIEW',
        }),
      }),
    );
  });

  it('rejects a previously registered invoice number before upload', async () => {
    tx.invoiceRecord.findFirst.mockResolvedValue({
      id: 'existing',
    });

    await expect(
      service.uploadSale(seller, 'order1', pdf, body),
    ).rejects.toThrow('fatura numarası');

    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(tx.invoiceRecord.create).not.toHaveBeenCalled();
  });

  it('removes stored PDF after database failure', async () => {
    tx.invoiceRecord.create.mockRejectedValue(
      new Error('database error'),
    );
    await expect(
      service.uploadSale(seller, 'order1', pdf, body),
    ).rejects.toThrow();
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid invoice date', async () => {
    await expect(
      service.uploadSale(
        seller, 'order1', pdf,
        { ...body, issuedAt: '2026-02-30' },
      ),
    ).rejects.toThrow();
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('allows a corrected PDF after a rejected invoice', async () => {
    tx.invoiceRecord.findFirst
      .mockResolvedValueOnce({
        id: 'old',
        orderId: 'order1',
        status: 'REJECTED',
      })
      .mockResolvedValueOnce(null);

    tx.invoiceRecord.findMany.mockResolvedValue([
      {
        orderId: 'order1',
        kind: 'SALE',
        status: 'REJECTED',
        revision: 1,
      },
    ]);

    await service.uploadSale(seller, 'order1', pdf, body);

    expect(tx.invoiceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invoiceNumber: body.invoiceNumber,
          revision: 2,
          status: 'PENDING_REVIEW',
        }),
      }),
    );
  });

  it('rejects reusing a rejected number on another order', async () => {
    tx.invoiceRecord.findFirst.mockResolvedValue({
      id: 'old',
      orderId: 'different-order',
      status: 'REJECTED',
    });

    await expect(
      service.uploadSale(seller, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(storage.upload).not.toHaveBeenCalled();
    expect(tx.invoiceRecord.create).not.toHaveBeenCalled();
  });

  it('blocks another active revision inside transaction', async () => {
    tx.invoiceRecord.findMany.mockResolvedValue([
      {
        orderId: 'order1',
        kind: 'SALE',
        status: 'PENDING_REVIEW',
        revision: 2,
      },
      {
        orderId: 'order1',
        kind: 'SALE',
        status: 'REJECTED',
        revision: 1,
      },
    ]);

    await expect(
      service.uploadSale(seller, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.create).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it('keeps old rejected records and increments revision', async () => {
    tx.invoiceRecord.findMany.mockResolvedValue([
      {
        orderId: 'order1',
        kind: 'SALE',
        status: 'REJECTED',
        revision: 2,
      },
      {
        orderId: 'order1',
        kind: 'SALE',
        status: 'REJECTED',
        revision: 1,
      },
    ]);

    await service.uploadSale(seller, 'order1', pdf, body);

    expect(tx.invoiceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revision: 3,
        }),
      }),
    );
  });

  it('rejects unsafe Cloudinary reference before database write', async () => {
    storage.upload.mockResolvedValue({
      publicId: 'tedarik-pazari-platform/products/product-1',
      resourceType: 'raw',
      deliveryType: 'authenticated',
    });

    await expect(service.uploadSale(seller, 'order1', pdf, body))
      .rejects.toThrow();

    expect(tx.invoiceRecord.create).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('preserves committed sale invoice when notification publishing throws', async () => {
    notifier.publish.mockImplementationOnce(() => {
      throw new Error('unexpected notification failure');
    });

    await expect(
      service.uploadSale(seller, 'order1', pdf, body),
    ).resolves.toMatchObject({
      id: 'invoice1',
      status: 'PENDING_REVIEW',
    });

    expect(tx.invoiceRecord.create).toHaveBeenCalledTimes(1);
    expect(storage.remove).not.toHaveBeenCalled();
  });

});
