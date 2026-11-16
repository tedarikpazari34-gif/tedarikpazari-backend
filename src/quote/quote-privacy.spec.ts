import { ForbiddenException } from '@nestjs/common';
import { QuoteService } from './quote.service';

describe('Teklif oluşturma gizliliği', () => {
  const setup = () => {
    const prisma = {
      rFQ: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rfq-1',
          status: 'OPEN',
          product: { sellerId: 'seller-1', title: 'Ürün' },
          buyer: {
            users: [{ id: 'buyer-user', email: 'buyer@example.com' }],
          },
        }),
      },
      quote: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'quote-1' }),
      },
    };
    const notifications = {
      createNotification: jest.fn().mockResolvedValue(undefined),
    };
    const mail = {
      sendMail: jest.fn().mockResolvedValue(undefined),
    };
    const service = new QuoteService(
      prisma as any, notifications as any, mail as any,
    );
    return { prisma, notifications, mail, service };
  };

  it('yanıtta özel alıcı ve satıcı bilgilerini seçmez', async () => {
    const { prisma, notifications, mail, service } = setup();

    await service.create(
      { role: 'SELLER', companyId: 'seller-1' },
      { rfqId: 'rfq-1', unitPrice: 100, deliveryDays: 3 } as any,
    );

    const query = prisma.quote.create.mock.calls[0][0];
    expect(query.include.rfq.include.buyer).toEqual({
      select: { id: true },
    });
    expect(query.include.seller).toEqual({
      select: { id: true },
    });

    expect(prisma.rFQ.findUnique.mock.calls[0][0]
      .include.buyer.select.users).toEqual({
        select: { id: true, email: true },
    });

    expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    expect(mail.sendMail).toHaveBeenCalledTimes(1);
  });

  it('firması olmayan satıcının teklifini reddeder', async () => {
    const { prisma, service } = setup();

    await expect(service.create(
      { role: 'SELLER', companyId: null },
      { rfqId: 'rfq-1' } as any,
    )).rejects.toThrow(ForbiddenException);

    expect(prisma.rFQ.findUnique).not.toHaveBeenCalled();
  });
});

describe('Teklif liste yetkilendirmesi', () => {
  const setup = () => {
    const prisma = {
      quote: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return {
      prisma,
      service: new QuoteService(
        prisma as any, {} as any, {} as any,
      ),
    };
  };

  it('satıcı yalnız kendi tekliflerini sorgular', async () => {
    const { prisma, service } = setup();
    await service.listMine({
      role: 'SELLER', companyId: 'seller-1',
    });

    const query = prisma.quote.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ sellerId: 'seller-1' });
    expect(query.include.rfq.include.buyer).toEqual({
      select: { id: true },
    });
  });

  it('alıcı yalnız kendi RFQ tekliflerini sorgular', async () => {
    const { prisma, service } = setup();
    await service.listForBuyer({
      role: 'BUYER', companyId: 'buyer-1',
    });

    const query = prisma.quote.findMany.mock.calls[0][0];
    expect(query.where.rfq).toEqual({ buyerId: 'buyer-1' });
    expect(query.include.seller.select.name).toBeUndefined();
  });

  it.each([
    ['SELLER', 'listMine'],
    ['BUYER', 'listForBuyer'],
  ])('firmasız %s kullanıcısını reddeder', async (role, method) => {
    const { prisma, service } = setup();

    await expect(
      (service as any)[method]({
        role, companyId: null,
      }),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.quote.findMany).not.toHaveBeenCalled();
  });

  it('yanlış rollerin teklif listelerine erişimini reddeder', async () => {
    const { prisma, service } = setup();

    await expect(service.listMine({
      role: 'BUYER', companyId: 'company-1',
    })).rejects.toThrow(ForbiddenException);

    await expect(service.listForBuyer({
      role: 'SELLER', companyId: 'company-1',
    })).rejects.toThrow(ForbiddenException);

    expect(prisma.quote.findMany).not.toHaveBeenCalled();
  });
});
