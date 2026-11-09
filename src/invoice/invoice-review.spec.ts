import { AdminInvoiceReviewService } from './invoice-review.service';

describe('Admin invoice review security', () => {
  const record = {
    id: 'invoice1',
    orderId: 'order1',
    buyerId: 'buyer1',
    sellerId: 'seller1',
    issuerCompanyId: 'seller1',
    kind: 'SALE',
    currency: 'TRY',
    netAmount: '100',
    vatAmount: '20',
    totalAmount: '120',
    status: 'PENDING_REVIEW',
    fileMimeType: 'application/pdf',
    storagePublicId: 'tedarik-pazari-platform/invoices/file1',
    storageResourceType: 'raw',
    storageDeliveryType: 'authenticated',
    order: {
      id: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'PAID',
      netAmount: '100',
      vatAmount: '20',
      totalAmount: '120',
      iyzicoPaidAt: new Date(),
      iyzicoPaymentTransactionId: 'txn1',
    },
  };

  const tx = {
    invoiceRecord: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    paymentTransaction: {
      findUnique: jest.fn(),
    },
    dispute: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };

  const prisma = {
    invoiceRecord: { findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };

  const notifier = {
    stage: jest.fn().mockResolvedValue([]),
    publish: jest.fn(),
  };

  const service = new AdminInvoiceReviewService(
    prisma as any, notifier as any,
  );

  const admin = { role: 'ADMIN', id: 'admin1' };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.invoiceRecord.findUnique.mockResolvedValue({
      orderId: 'order1',
    });
    tx.invoiceRecord.findUnique.mockResolvedValue(record);

    tx.dispute.findUnique.mockResolvedValue({
      id: 'dispute1',
      orderId: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'OPEN',
      resolvedAt: null,
    });
    tx.invoiceRecord.findFirst.mockResolvedValue(null);
    tx.invoiceRecord.updateMany.mockResolvedValue({ count: 1 });
    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: null,
      iyzicoRefundedAt: null,
    });
  });

  it('rejects buyer review attempts', async () => {
    await expect(
      service.review(
        { role: 'BUYER', id: 'buyerUser' },
        'invoice1',
        { action: 'APPROVE' },
      ),
    ).rejects.toThrow();

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects missing admin identity', async () => {
    await expect(
      service.review(
        { role: 'ADMIN' },
        'invoice1',
        { action: 'APPROVE' },
      ),
    ).rejects.toThrow();
  });

  it('rejects invalid actions', async () => {
    await expect(
      service.review(admin, 'invoice1', { action: 'CANCEL' }),
    ).rejects.toThrow();
  });

  it('requires a meaningful rejection reason', async () => {
    await expect(
      service.review(
        admin,
        'invoice1',
        { action: 'REJECT', reason: 'bad' },
      ),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    null,
    '',
    'tedarik-pazari-platform/products/file1',
    'tedarik-pazari-platform/invoices/',
    'tedarik-pazari-platform/invoices/../other',
    'tedarik-pazari-platform/invoices/file.pdf',
  ])('blocks invalid invoice storage path: %s', async publicId => {
    tx.invoiceRecord.findUnique.mockResolvedValue({
      ...record,
      storagePublicId: publicId,
    });

    await expect(
      service.review(admin, 'invoice1', { action: 'APPROVE' }),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
    expect(notifier.stage).not.toHaveBeenCalled();
  });

  it('approves only pending invoices with verified payment', async () => {
    const result = await service.review(
      admin, 'invoice1', { action: 'APPROVE' },
    );

    expect(result.status).toBe('RECORDED');
    expect(tx.paymentTransaction.findUnique).toHaveBeenCalled();
    expect(tx.invoiceRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'PENDING_REVIEW',
        }),
        data: expect.objectContaining({
          status: 'RECORDED',
          reviewedByUserId: 'admin1',
        }),
      }),
    );
  });

  it('rejects with a recorded reason', async () => {
    const result = await service.review(
      admin,
      'invoice1',
      {
        action: 'REJECT',
        reason: 'Fatura bilgileri uyuşmuyor',
      },
    );

    expect(result.status).toBe('REJECTED');
    expect(result.reviewNote).toBe('Fatura bilgileri uyuşmuyor');
    expect(tx.paymentTransaction.findUnique).not.toHaveBeenCalled();
  });

  it('does not approve invoices during refund', async () => {
    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: new Date(),
      iyzicoRefundedAt: null,
    });

    await expect(
      service.review(
        admin, 'invoice1', { action: 'APPROVE' },
      ),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('does not allow a second review', async () => {
    tx.invoiceRecord.findUnique.mockResolvedValue({
      ...record,
      status: 'RECORDED',
    });

    await expect(
      service.review(
        admin, 'invoice1', { action: 'REJECT', reason: 'Tekrar inceleme yapılamaz' },
      ),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('detects concurrent status updates', async () => {
    tx.invoiceRecord.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.review(
        admin, 'invoice1', { action: 'APPROVE' },
      ),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).toHaveBeenCalledTimes(1);
  });

  it('blocks approval when the registered amount differs', async () => {
    tx.invoiceRecord.findUnique.mockResolvedValue({
      ...record,
      totalAmount: '121',
    });

    await expect(
      service.review(admin, 'invoice1', { action: 'APPROVE' }),
    ).rejects.toThrow('totalAmount');

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('blocks approval of a cancelled order', async () => {
    tx.invoiceRecord.findUnique.mockResolvedValue({
      ...record,
      order: { ...record.order, status: 'CANCELLED' },
    });

    await expect(
      service.review(admin, 'invoice1', { action: 'APPROVE' }),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('blocks approval if an iyzico refund is completed', async () => {
    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: null,
      iyzicoRefundedAt: new Date(),
    });

    await expect(
      service.review(admin, 'invoice1', { action: 'APPROVE' }),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('does not approve return invoices using sale rules', async () => {
    tx.invoiceRecord.findUnique.mockResolvedValue({
      ...record,
      kind: 'RETURN',
    });

    await expect(
      service.review(admin, 'invoice1', { action: 'APPROVE' }),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  const originalSale = {
    id: 'sale1',
    orderId: 'order1',
    buyerId: 'buyer1',
    sellerId: 'seller1',
    issuerCompanyId: 'seller1',
    kind: 'SALE',
    status: 'RECORDED',
    currency: 'TRY',
    netAmount: '100',
    vatAmount: '20',
    totalAmount: '120',
  };

  function mockReturn(kind: 'RETURN' | 'CREDIT_NOTE') {
    tx.dispute.findUnique.mockResolvedValue({
      id: 'dispute1',
      orderId: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: 'RESOLVED_BUYER',
      resolution: 'REFUND_TO_BUYER',
      resolvedAt: new Date(),
    });

    const invoice = {
      ...record,
      kind,
      issuerCompanyId:
        kind === 'RETURN' ? 'buyer1' : 'seller1',
      originalSaleInvoiceId: 'sale1',
      disputeId: 'dispute1',
      order: {
        ...record.order,
        status: 'CANCELLED',
      },
    };

    tx.invoiceRecord.findUnique.mockImplementation(
      async ({ where }: any) =>
        where.id === 'sale1' ? originalSale : invoice,
    );

    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      amount: '120',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: null,
      iyzicoRefundedAt: new Date(),
      iyzicoRefundedAmount: '120',
    });

    return invoice;
  }

  it('approves buyer RETURN after completed full refund', async () => {
    mockReturn('RETURN');

    const result = await service.review(
      admin, 'invoice1', { action: 'APPROVE' },
    );

    expect(result.status).toBe('RECORDED');
    expect(tx.invoiceRecord.updateMany).toHaveBeenCalledTimes(1);

    expect(notifier.stage).toHaveBeenCalledWith(
      tx,
      'BUYER',
      'buyer1',
      expect.objectContaining({ link: '/buyer/orders' }),
    );

    expect(notifier.stage).toHaveBeenCalledWith(
      tx,
      'SELLER',
      'seller1',
      expect.objectContaining({ link: '/seller/orders' }),
    );
  });

  it.each(['PAID', 'PREPARING', 'SHIPPED'] as const)(
    'approves buyer RETURN before refund for %s',
    async (status) => {
      const invoice = mockReturn('RETURN');

      tx.dispute.findUnique.mockResolvedValue({
        id: 'dispute1',
        orderId: 'order1',
        buyerId: 'buyer1',
        sellerId: 'seller1',
        status: 'OPEN',
        resolution: null,
        resolvedAt: null,
      });

      tx.invoiceRecord.findUnique.mockImplementation(
        async ({ where }: any) =>
          where.id === 'sale1'
            ? originalSale
            : { ...invoice, order: { ...invoice.order, status } },
      );

      tx.paymentTransaction.findUnique.mockResolvedValue({
        orderId: 'order1',
        sellerId: 'seller1',
        amount: '120',
        status: 'SUCCESS',
        iyzicoRefundPendingAt: null,
        iyzicoRefundedAt: null,
        iyzicoRefundedAmount: '0',
      });

      const result = await service.review(
        admin, 'invoice1', { action: 'APPROVE' },
      );

      expect(result.status).toBe('RECORDED');
      expect(tx.paymentTransaction.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { paymentTransactionId: 'txn1' },
        }),
      );
      expect(tx.invoiceRecord.updateMany).toHaveBeenCalledTimes(1);
    },
  );

  it('approves seller CREDIT_NOTE after completed full refund', async () => {
    mockReturn('CREDIT_NOTE');

    const result = await service.review(
      admin, 'invoice1', { action: 'APPROVE' },
    );

    expect(result.status).toBe('RECORDED');
  });

  it('sends buyer RETURN rejection only to buyer', async () => {
    mockReturn('RETURN');

    const result = await service.review(
      admin,
      'invoice1',
      {
        action: 'REJECT',
        reason: 'Belge bilgilerinde eksiklik var',
      },
    );

    expect(result.status).toBe('REJECTED');
    expect(notifier.stage).toHaveBeenCalledTimes(1);

    expect(notifier.stage).toHaveBeenCalledWith(
      tx,
      'BUYER',
      'buyer1',
      expect.objectContaining({
        link: '/buyer/orders',
      }),
    );
  });

  it('blocks approval while refund is pending', async () => {
    mockReturn('RETURN');

    tx.paymentTransaction.findUnique.mockResolvedValue({
      orderId: 'order1',
      sellerId: 'seller1',
      amount: '120',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: new Date(),
      iyzicoRefundedAt: null,
      iyzicoRefundedAmount: '0',
    });

    await expect(
      service.review(
        admin, 'invoice1', { action: 'APPROVE' },
      ),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('blocks approval for altered return amount', async () => {
    const invoice = mockReturn('RETURN');

    tx.invoiceRecord.findUnique.mockImplementation(
      async ({ where }: any) =>
        where.id === 'sale1'
          ? originalSale
          : { ...invoice, totalAmount: '119' },
    );

    await expect(
      service.review(
        admin, 'invoice1', { action: 'APPROVE' },
      ),
    ).rejects.toThrow('tutarları');

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('blocks return approval without original sale', async () => {
    mockReturn('RETURN');

    tx.invoiceRecord.findUnique.mockImplementation(
      async ({ where }: any) =>
        where.id === 'sale1' ? null : {
          ...record,
          kind: 'RETURN',
          issuerCompanyId: 'buyer1',
          originalSaleInvoiceId: 'sale1',
          disputeId: 'dispute1',
          order: { ...record.order, status: 'CANCELLED' },
        },
    );

    await expect(
      service.review(
        admin, 'invoice1', { action: 'APPROVE' },
      ),
    ).rejects.toThrow();

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('blocks a second recorded return document', async () => {
    mockReturn('RETURN');

    tx.invoiceRecord.findFirst.mockResolvedValue({
      id: 'already-recorded',
    });

    await expect(
      service.review(
        admin, 'invoice1', { action: 'APPROVE' },
      ),
    ).rejects.toThrow('zaten onaylanmış');

    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it('rejects return with seller as issuer', async () => {
    const invoice = mockReturn('RETURN');

    tx.invoiceRecord.findUnique.mockResolvedValue({
      ...invoice,
      issuerCompanyId: 'seller1',
    });

    await expect(
      service.review(
        admin, 'invoice1', { action: 'REJECT', reason: 'Belge hatalı düzenlenmiş' },
      ),
    ).rejects.toThrow();

    expect(notifier.stage).not.toHaveBeenCalled();
    expect(tx.invoiceRecord.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      action: 'APPROVE',
      status: 'RECORDED',
      reason: undefined,
    },
    {
      action: 'REJECT',
      status: 'REJECTED',
      reason: 'Belge bilgilerinde eksiklik var',
    },
  ])(
    'preserves committed $action review when notification publishing throws',
    async ({ action, status, reason }) => {
      notifier.publish.mockImplementationOnce(() => {
        throw new Error('unexpected notification failure');
      });

      await expect(
        service.review(
          admin,
          'invoice1',
          { action, ...(reason ? { reason } : {}) },
        ),
      ).resolves.toMatchObject({
        invoiceId: 'invoice1',
        status,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.invoiceRecord.updateMany).toHaveBeenCalledTimes(1);
      expect(notifier.stage).toHaveBeenCalled();
      expect(notifier.publish).toHaveBeenCalledTimes(1);
    },
  );

});
