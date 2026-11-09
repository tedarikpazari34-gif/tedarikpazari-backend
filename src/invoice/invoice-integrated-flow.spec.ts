import { SellerInvoiceUploadService } from './invoice-upload.service';
import { AdminInvoiceReviewService } from './invoice-review.service';
import { InvoiceService } from './invoice.service';

describe('Integrated invoice lifecycle - isolated', () => {
  it('seller upload -> admin approval -> buyer download', async () => {
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

    const payment = {
      orderId: 'order1',
      sellerId: 'seller1',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: null,
      iyzicoRefundedAt: null,
    };

    let record: any = null;

    const invoiceRecord = {
      findUnique: jest.fn(async ({ where }: any) =>
        record?.id === where.id
          ? { ...record, order }
          : null
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        if (!record) return null;
        if (where?.id?.not === record.id) return null;
        if (where?.status === 'RECORDED' &&
            record.status !== 'RECORDED') return null;
        if (where?.status?.in &&
            !where.status.in.includes(record.status)) return null;
        if (where?.issuerCompanyId &&
            record.issuerCompanyId !== where.issuerCompanyId) return null;
        if (where?.invoiceNumber &&
            record.invoiceNumber !== where.invoiceNumber) return null;
        if (where?.orderId && record.orderId !== where.orderId) return null;
        return record;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        if (!record) return [];
        if (where?.invoiceNumber) return [];
        if (where?.buyerId && record.buyerId !== where.buyerId) return [];
        if (where?.sellerId && record.sellerId !== where.sellerId) return [];
        if (where?.OR && !where.OR.some((condition: any) =>
          (condition.status && condition.status === record.status) ||
          (condition.issuerCompanyId &&
           condition.issuerCompanyId === record.issuerCompanyId)
        )) return [];
        return [record];
      }),
      create: jest.fn(async ({ data }: any) => {
        record = {
          ...data,
          id: 'invoice1',
          createdAt: new Date(),
          order,
        };
        return record;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!record ||
            record.id !== where.id ||
            record.status !== where.status) {
          return { count: 0 };
        }
        Object.assign(record, data);
        return { count: 1 };
      }),
    };

    const prisma: any = {
      company: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'APPROVED',
          verified: true,
        }),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
      },
      paymentTransaction: {
        findUnique: jest.fn().mockResolvedValue(payment),
      },
      invoiceRecord,
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
    };

    const storage: any = {
      upload: jest.fn().mockResolvedValue({
        publicId: 'tedarik-pazari-platform/invoices/testfile',
        resourceType: 'raw',
        deliveryType: 'authenticated',
      }),
      remove: jest.fn(),
      createDownloadUrl: jest.fn().mockReturnValue({
        url: 'https://example.com/private-signed-pdf',
        expiresAt: '2026-11-10T00:00:00.000Z',
      }),
    };

    const notifier: any = {
      stage: jest.fn().mockResolvedValue([]),
      publish: jest.fn(),
    };

    const upload = new SellerInvoiceUploadService(
      prisma, storage, notifier,
    );
    const review = new AdminInvoiceReviewService(prisma, notifier);
    const access = new InvoiceService(prisma, storage);

    const seller = {
      id: 'seller-user',
      role: 'SELLER',
      companyId: 'seller1',
    };
    const buyer = {
      id: 'buyer-user',
      role: 'BUYER',
      companyId: 'buyer1',
    };
    const admin = {
      id: 'admin-user',
      role: 'ADMIN',
    };

    const pdf = {
      buffer: Buffer.from('%PDF-1.7\n1 0 obj\nendobj\n%%EOF'),
      mimetype: 'application/pdf',
    } as any;

    await upload.uploadSale(seller, order.id, pdf, {
      invoiceNumber: 'TEST2026000001',
      channel: 'E_ARCHIVE',
      issuedAt: '2026-11-09',
    });

    expect(record.status).toBe('PENDING_REVIEW');
    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(await access.listMine(buyer)).toHaveLength(0);

    await expect(
      access.download(buyer, record.id)
    ).rejects.toThrow();

    const decision = await review.review(admin, record.id, {
      action: 'APPROVE',
    });

    expect(decision.status).toBe('RECORDED');
    expect(record.status).toBe('RECORDED');

    const buyerInvoices = await access.listMine(buyer);
    expect(buyerInvoices).toHaveLength(1);

    const permission = await access.verifyDownloadAccess(
      buyer, record.id,
    );
    expect(permission.authorized).toBe(true);

    const downloaded = await access.download(buyer, record.id);
    expect(downloaded.invoiceId).toBe(record.id);
    expect(downloaded.url).toContain('https://');
    expect(downloaded).not.toHaveProperty('storagePublicId');

    await expect(
      access.download(
        { role: 'BUYER', companyId: 'other-company' },
        record.id,
      )
    ).rejects.toThrow();

    await expect(
      review.review(admin, record.id, { action: 'APPROVE' })
    ).rejects.toThrow();

    expect(storage.upload).toHaveBeenCalledTimes(1);
    expect(storage.createDownloadUrl).toHaveBeenCalledTimes(1);
  });
});
