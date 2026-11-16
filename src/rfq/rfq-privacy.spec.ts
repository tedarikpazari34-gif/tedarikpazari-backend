import { ForbiddenException } from '@nestjs/common';
import { RfqService } from './rfq.service';

describe('RFQ satıcı teklif gizliliği', () => {
  const setup = () => {
    const prisma = {
      rFQ: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rfq-1',
          status: 'OPEN',
          quotes: [{ sellerId: 'seller-1' }],
        }),
      },
    };
    const service = new RfqService(
      prisma as any,
      {} as any,
      {} as any,
    );
    return { prisma, service };
  };

  it('satıcı yalnız kendi tekliflerini sorgular', async () => {
    const { prisma, service } = setup();
    await service.getForSellerById(
      { role: 'SELLER', companyId: 'seller-1' },
      'rfq-1',
    );

    const query = prisma.rFQ.findUnique.mock.calls[0][0];
    expect(query.include.quotes.where).toEqual({
      sellerId: 'seller-1',
    });
    expect(query.include.quotes.include.seller).toEqual({
      select: { id: true },
    });
  });

  it('firması olmayan satıcıya erişim vermez', async () => {
    const { prisma, service } = setup();

    await expect(
      service.getForSellerById(
        { role: 'SELLER', companyId: null },
        'rfq-1',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.rFQ.findUnique).not.toHaveBeenCalled();
  });

  it.each(['BUYER', 'ADMIN', 'LOGISTICS'])(
    '%s rolü satıcı detayına erişemez',
    async (role) => {
      const { prisma, service } = setup();

      await expect(
        service.getForSellerById(
          { role, companyId: 'company-1' },
          'rfq-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.rFQ.findUnique).not.toHaveBeenCalled();
    },
  );
});

describe('RFQ alıcı liste gizliliği', () => {
  const setup = () => {
    const prisma = {
      rFQ: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new RfqService(
      prisma as any, {} as any, {} as any,
    );
    return { prisma, service };
  };

  it('satıcı firma bilgilerinden yalnız ID getirir', async () => {
    const { prisma, service } = setup();
    await service.listMine({
      role: 'BUYER', companyId: 'buyer-1',
    });

    const query = prisma.rFQ.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ buyerId: 'buyer-1' });
    expect(query.include.quotes.include.seller).toEqual({
      select: { id: true },
    });
  });

  it('firması olmayan alıcıyı reddeder', async () => {
    const { prisma, service } = setup();
    await expect(service.listMine({
      role: 'BUYER', companyId: null,
    })).rejects.toThrow(ForbiddenException);
    expect(prisma.rFQ.findMany).not.toHaveBeenCalled();
  });
});

describe('RFQ liste teklif gizliliği', () => {
  const setup = () => {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([]) },
      rFQ: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return {
      prisma,
      service: new RfqService(prisma as any, {} as any, {} as any),
    };
  };

  it('açık RFQ listesinde yalnız teklif sayısını getirir', async () => {
    const { prisma, service } = setup();
    await service.listOpen();
    const query = prisma.rFQ.findMany.mock.calls[0][0];
    expect(query.include._count).toEqual({
      select: { quotes: true },
    });
    expect(query.include.quotes).toBeUndefined();
  });

  it('satıcıya gelen RFQ listesinde rakip tekliflerini gizler', async () => {
    const { prisma, service } = setup();
    await service.listForSeller({
      role: 'SELLER', companyId: 'seller-1',
    });
    const query = prisma.rFQ.findMany.mock.calls[0][0];
    expect(query.include._count).toEqual({
      select: { quotes: true },
    });
    expect(query.include.quotes).toBeUndefined();
  });

  it('firması olmayan satıcıyı reddeder', async () => {
    const { prisma, service } = setup();
    await expect(service.listForSeller({
      role: 'SELLER', companyId: null,
    })).rejects.toThrow(ForbiddenException);
    expect(prisma.rFQ.findMany).not.toHaveBeenCalled();
  });
});
