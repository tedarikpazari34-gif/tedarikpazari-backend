import { InvoiceService } from './invoice.service';

describe('Invoice listing API contract', () => {
  const findMany = jest.fn();

  const prisma = {
    invoiceRecord: {
      findMany,
    },
  };

  const service = new InvoiceService(
    prisma as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([]);
  });

  it('returns the original invoice link to buyers', async () => {
    await service.listMine({
      role: 'BUYER',
      companyId: 'buyer1',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        buyerId: 'buyer1',
        OR: [
          { status: 'RECORDED' },
          { issuerCompanyId: 'buyer1' },
        ],
      },
      select: expect.objectContaining({
        id: true,
        orderId: true,
        kind: true,
        revision: true,
        originalSaleInvoiceId: true,
        status: true,
        reviewNote: true,
      }),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  it('returns the original invoice link to sellers', async () => {
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
        select: expect.objectContaining({
          originalSaleInvoiceId: true,
          invoiceNumber: true,
          revision: true,
          kind: true,
        }),
      }),
    );
  });

  it('returns linked document details to admins', async () => {
    await service.listAdmin({
      id: 'admin1',
      role: 'ADMIN',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          buyerId: true,
          sellerId: true,
          issuerCompanyId: true,
          originalSaleInvoiceId: true,
          kind: true,
          status: true,
          revision: true,
          reviewNote: true,
        }),
      }),
    );
  });

  it('does not expose private PDF storage identifiers', async () => {
    for (const user of [
      { role: 'BUYER', companyId: 'buyer1' },
      { role: 'SELLER', companyId: 'seller1' },
      { role: 'ADMIN', id: 'admin1' },
    ]) {
      if (user.role === 'ADMIN') {
        await service.listAdmin(user);
      } else {
        await service.listMine(user);
      }

      const call = findMany.mock.calls[
        findMany.mock.calls.length - 1
      ][0];

      expect(call.select).not.toHaveProperty(
        'storagePublicId'
      );
      expect(call.select).not.toHaveProperty(
        'fileSha256'
      );
    }
  });

  it('blocks users without invoice listing permission', async () => {
    await expect(
      service.listMine({
        role: 'LOGISTICS',
        companyId: 'logistics1',
      }),
    ).rejects.toThrow();

    await expect(
      service.listMine({
        role: 'BUYER',
        companyId: '',
      }),
    ).rejects.toThrow();

    expect(findMany).not.toHaveBeenCalled();
  });

  it('preserves linked invoice identifiers in list results', async () => {
    const invoice = {
      id: 'return1',
      orderId: 'order1',
      kind: 'RETURN',
      revision: 2,
      originalSaleInvoiceId: 'sale1',
      status: 'REJECTED',
      reviewNote: 'Belge bilgileri eksik',
    };

    findMany.mockResolvedValue([invoice]);

    const result = await service.listMine({
      role: 'BUYER',
      companyId: 'buyer1',
    });

    expect(result).toEqual([invoice]);
    expect(result[0].originalSaleInvoiceId).toBe('sale1');
  });
});
