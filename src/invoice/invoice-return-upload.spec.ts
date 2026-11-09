import { ReturnInvoiceUploadService } from './invoice-return-upload.service';

describe('Return document upload security', () => {
  const order = {
    id: 'order1',
    buyerId: 'buyer1',
    sellerId: 'seller1',
    status: 'CANCELLED',
    totalAmount: '120.00',
    iyzicoPaymentTransactionId: 'canonical-iyzico-tx-1',
  };

  const sale = {
    id: 'sale1',
    orderId: 'order1',
    buyerId: 'buyer1',
    sellerId: 'seller1',
    issuerCompanyId: 'seller1',
    kind: 'SALE',
    status: 'RECORDED',
    currency: 'TRY',
    netAmount: '100.00',
    vatAmount: '20.00',
    totalAmount: '120.00',
  };

  const tx = {
    company: { findUnique: jest.fn() },
    order: { findUnique: jest.fn() },
    dispute: { findUnique: jest.fn() },
    paymentTransaction: { findUnique: jest.fn() },
    invoiceRecord: {
      findUnique: jest.fn(),
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
    stage: jest.fn(),
    publish: jest.fn(),
  };

  const service = new ReturnInvoiceUploadService(
    prisma as any,
    storage as any,
    notifier as any,
  );

  const buyer = {
    id: 'buyerUser',
    role: 'BUYER',
    companyId: 'buyer1',
  };

  const seller = {
    id: 'sellerUser',
    role: 'SELLER',
    companyId: 'seller1',
  };

  const pdf = {
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nendobj\n%%EOF'),
  } as any;

  const body = {
    disputeId: 'dispute1',
    kind: 'RETURN',
    originalSaleInvoiceId: 'sale1',
    invoiceNumber: 'RET202600001',
    channel: 'E_ARCHIVE',
    issuedAt: '2026-10-30',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    tx.company.findUnique.mockResolvedValue({
      status: 'APPROVED',
      verified: true,
    });

    tx.order.findUnique.mockResolvedValue(order);

    tx.dispute.findUnique.mockResolvedValue({
      id: 'dispute1',
      orderId: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'RESOLVED_BUYER',
      resolution: 'REFUND_TO_BUYER',
      resolvedAt: new Date(),
    });

    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      amount: '120.00',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: null,
      iyzicoRefundedAt: new Date(),
      iyzicoRefundedAmount: '120.00',
    });

    tx.invoiceRecord.findUnique.mockResolvedValue(sale);
    tx.invoiceRecord.findFirst.mockResolvedValue(null);
    tx.invoiceRecord.findMany.mockResolvedValue([]);

    tx.invoiceRecord.create.mockResolvedValue({
      id: 'return1',
      orderId: 'order1',
      kind: 'RETURN',
      revision: 1,
      status: 'PENDING_REVIEW',
    });

    storage.upload.mockResolvedValue({
      publicId: 'tedarik-pazari-platform/invoices/return1',
      resourceType: 'raw',
      deliveryType: 'authenticated',
    });

    storage.remove.mockResolvedValue(undefined);
    notifier.stage.mockResolvedValue([]);
  });

  it('uses the canonical iyzico transaction when verifying return documents', async () => {
    await service.upload(buyer, 'order1', pdf, body);

    expect(tx.paymentTransaction.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          paymentTransactionId: 'canonical-iyzico-tx-1',
        },
      }),
    );
  });

  it('rejects missing canonical iyzico transaction before storage upload', async () => {
    tx.order.findUnique.mockResolvedValue({
      ...order,
      iyzicoPaymentTransactionId: null,
    });

    await expect(
      service.upload(buyer, 'order1', pdf, body),
    ).rejects.toThrow('Kanonik iyzico işlem kimliği bulunamadı');

    expect(tx.paymentTransaction.findUnique).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(tx.invoiceRecord.create).not.toHaveBeenCalled();
  });

  it('allows authorized buyer return upload', async () => {
    const result = await service.upload(buyer, 'order1', pdf, body);

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
          originalSaleInvoiceId: 'sale1',
          disputeId: 'dispute1',
          issuerCompanyId: 'buyer1',
          kind: 'RETURN',
          revision: 1,
        }),
      }),
    );
  });

  it('allows seller credit note documentation', async () => {
    const result = await service.upload(
      seller, 'order1', pdf,
      {
        ...body,
        kind: 'CREDIT_NOTE',
        invoiceNumber: 'CR202600001',
      },
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
          issuerCompanyId: 'seller1',
          kind: 'CREDIT_NOTE',
        }),
      }),
    );
  });

  it('rejects wrong company before uploading PDF', async () => {
    await expect(
      service.upload(
        { ...buyer, companyId: 'different' },
        'order1', pdf, body,
      ),
    ).rejects.toThrow();

    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects seller uploading buyer return', async () => {
    await expect(
      service.upload(seller, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects pending iyzico refunds', async () => {
    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      amount: '120.00',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: new Date(),
      iyzicoRefundedAt: null,
      iyzicoRefundedAmount: '0',
    });

    await expect(
      service.upload(buyer, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('rejects unrelated original sale documents', async () => {
    tx.invoiceRecord.findUnique.mockResolvedValue({
      ...sale,
      orderId: 'different-order',
    });

    await expect(
      service.upload(buyer, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('blocks an active return on the same order', async () => {
    tx.invoiceRecord.findFirst.mockResolvedValue({
      id: 'existing-return',
    });

    await expect(
      service.upload(buyer, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(tx.invoiceRecord.create).not.toHaveBeenCalled();
  });

  it('supports corrected rejected return revisions', async () => {
    tx.invoiceRecord.findMany.mockResolvedValue([
      {
        orderId: 'order1',
        originalSaleInvoiceId: 'sale1',
        kind: 'RETURN',
        status: 'REJECTED',
        revision: 1,
      },
    ]);

    await service.upload(buyer, 'order1', pdf, body);

    expect(tx.invoiceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revision: 2,
        }),
      }),
    );
  });

  it('blocks a reused number belonging to another order', async () => {
    tx.invoiceRecord.findMany.mockResolvedValue([
      {
        orderId: 'different-order',
        originalSaleInvoiceId: 'sale1',
        kind: 'RETURN',
        status: 'REJECTED',
        revision: 1,
      },
    ]);

    await expect(
      service.upload(buyer, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it('cleans up the PDF when database creation fails', async () => {
    tx.invoiceRecord.create.mockRejectedValue(
      new Error('database unavailable'),
    );

    await expect(
      service.upload(buyer, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    '',
    'tedarik-pazari-platform/products/file1',
    'tedarik-pazari-platform/invoices/',
    'tedarik-pazari-platform/invoices/../other',
    'tedarik-pazari-platform/invoices/file.pdf',
  ])('rejects invalid stored invoice publicId: %s', async publicId => {
    storage.upload.mockResolvedValue({
      publicId,
      resourceType: 'raw',
      deliveryType: 'authenticated',
    });

    await expect(
      service.upload(buyer, 'order1', pdf, body),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.create).not.toHaveBeenCalled();
    expect(notifier.stage).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid PDF before storage', async () => {
    await expect(
      service.upload(
        buyer, 'order1',
        {
          mimetype: 'application/pdf',
          buffer: Buffer.from('invalid'),
        } as any,
        body,
      ),
    ).rejects.toThrow();

    expect(storage.upload).not.toHaveBeenCalled();
  });

  it('does not publish notices before transaction commit', async () => {
    prisma.$transaction.mockImplementationOnce(async (fn: any) => {
      const result = await fn(tx);
      expect(notifier.publish).not.toHaveBeenCalled();
      return result;
    });

    await service.upload(buyer, 'order1', pdf, body);

    expect(notifier.stage).toHaveBeenCalled();
    expect(notifier.publish).toHaveBeenCalledTimes(1);
  });

  it('preserves committed PDF when notification publishing throws', async () => {
    notifier.publish.mockImplementationOnce(() => {
      throw new Error('unexpected notification failure');
    });

    await expect(
      service.upload(buyer, 'order1', pdf, body),
    ).resolves.toMatchObject({
      id: 'return1',
    });

    expect(tx.invoiceRecord.create).toHaveBeenCalledTimes(1);
    expect(storage.remove).not.toHaveBeenCalled();
  });

});
