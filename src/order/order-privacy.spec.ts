import { Role } from '@prisma/client';
import { OrderService } from './order.service';

describe('OrderService sipariş API gizliliği', () => {
  const findMany = jest.fn();
  const findUnique = jest.fn();

  const sensitiveOrder = {
    id: 'order-privacy-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status: 'PAID',
    totalAmount: '600',
    productTitleSnapshot: 'Test Ürünü',
    iyzicoCheckoutToken: 'SECRET_CHECKOUT_TOKEN',
    iyzicoRawResult: {
      secret: 'SECRET_PAYMENT_RESULT',
    },
    commissionAmount: '60',
    payoutAmount: '540',
    buyer: { id: 'buyer-1' },
    seller: { id: 'seller-1' },
    product: { title: 'Test Ürünü' },
    disputes: [],
  };

  const createService = () => {
    const prisma = {
      order: { findMany, findUnique },
    };

    return new OrderService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
  };

  const applySelect = (data: any, select: any): any => {
    if (data == null || !select) return data;

    if (Array.isArray(data)) {
      return data.map((item) => applySelect(item, select));
    }

    const result: Record<string, any> = {};

    for (const [key, rule] of Object.entries(select)) {
      if (rule === true) {
        if (key in data) result[key] = data[key];
      } else if (rule && typeof rule === 'object') {
        const nested = (rule as any).select;
        if (nested && key in data) {
          result[key] = applySelect(data[key], nested);
        }
      }
    }

    return result;
  };

  beforeEach(() => {
    jest.resetAllMocks();

    findMany.mockImplementation(async (args: any) =>
      applySelect([sensitiveOrder], args.select),
    );

    findUnique.mockImplementation(async (args: any) =>
      applySelect(sensitiveOrder, args.select),
    );
  });

  it('liste sorgusu açık alan seçimi kullanır', async () => {
    findMany.mockResolvedValue([]);

    await createService().list({
      role: Role.BUYER,
      companyId: 'buyer-1',
    });

    const args = findMany.mock.calls[0][0];

    expect(args.where).toEqual({ buyerId: 'buyer-1' });
    expect(args.select).toBeDefined();
    expect(args.include).toBeUndefined();
    expect(args.select.iyzicoCheckoutToken).not.toBe(true);
    expect(args.select.iyzicoRawResult).not.toBe(true);
    expect(args.select.commissionAmount).not.toBe(true);
    expect(args.select.payoutAmount).not.toBe(true);
  });

  it('detay sorgusu açık alan seçimi kullanır', async () => {

    await createService().getOne(
      { role: Role.BUYER, companyId: 'buyer-1' },
      'order-privacy-1',
    );

    const args = findUnique.mock.calls[0][0];

    expect(args.select).toBeDefined();
    expect(args.include).toBeUndefined();
    expect(args.select.iyzicoCheckoutToken).not.toBe(true);
    expect(args.select.iyzicoRawResult).not.toBe(true);
    expect(args.select.commissionAmount).not.toBe(true);
    expect(args.select.payoutAmount).not.toBe(true);
  });

  it('alıcı sipariş listesinde hassas ödeme alanları bulunmaz', async () => {

    const result = await createService().list({
      role: Role.BUYER,
      companyId: 'buyer-1',
    });

    const response = JSON.stringify(result);

    expect(response).not.toContain('SECRET_CHECKOUT_TOKEN');
    expect(response).not.toContain('SECRET_PAYMENT_RESULT');
    expect(response).not.toContain('commissionAmount');
    expect(response).not.toContain('payoutAmount');

    expect(result[0].id).toBe('order-privacy-1');
  });

  it('alıcı sipariş detayında hassas ödeme alanları bulunmaz', async () => {

    const result = await createService().getOne(
      { role: Role.BUYER, companyId: 'buyer-1' },
      'order-privacy-1',
    );

    const response = JSON.stringify(result);

    expect(response).not.toContain('SECRET_CHECKOUT_TOKEN');
    expect(response).not.toContain('SECRET_PAYMENT_RESULT');
    expect(response).not.toContain('commissionAmount');
    expect(response).not.toContain('payoutAmount');

    expect(result.id).toBe('order-privacy-1');
    expect(result.productTitleSnapshot).toBe('Test Ürünü');
  });

  it('alıcı başka şirketin sipariş detayına erişemez', async () => {
    await expect(
      createService().getOne(
        { role: Role.BUYER, companyId: 'buyer-other' },
        'order-privacy-1',
      ),
    ).rejects.toThrow('Bu order size ait değil');
  });

  it('satıcı başka şirketin sipariş detayına erişemez', async () => {
    await expect(
      createService().getOne(
        { role: Role.SELLER, companyId: 'seller-other' },
        'order-privacy-1',
      ),
    ).rejects.toThrow('Bu order size ait değil');
  });

  it('satıcı listesi kendi şirketiyle sınırlandırılır', async () => {
    await createService().list({
      role: Role.SELLER,
      companyId: 'seller-1',
    });

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ sellerId: 'seller-1' });
    expect(args.select.commissionAmount).toBe(true);
    expect(args.select.iyzicoCheckoutToken).not.toBe(true);
    expect(args.select.iyzicoRawResult).not.toBe(true);
  });

  it('alıcı ve satıcı yönetici uyuşmazlık notunu göremez', async () => {
    for (const role of [Role.BUYER, Role.SELLER]) {
      const companyId = role === Role.BUYER ? 'buyer-1' : 'seller-1';

      await createService().getOne(
        { role, companyId },
        'order-privacy-1',
      );

      const args = findUnique.mock.calls.at(-1)[0];
      expect(args.select.disputes.select.adminNote).not.toBe(true);
    }
  });

  it('yönetici finans alanlarını görür ama gizli iyzico verilerini görmez', async () => {
    await createService().getOne(
      { role: Role.ADMIN },
      'order-privacy-1',
    );

    const args = findUnique.mock.calls[0][0];

    expect(args.select.commissionAmount).toBe(true);
    expect(args.select.escrowAmount).toBe(true);
    expect(args.select.payoutAmount).toBe(true);
    expect(args.select.disputes.select.adminNote).toBe(true);
    expect(args.select.iyzicoCheckoutToken).not.toBe(true);
    expect(args.select.iyzicoRawResult).not.toBe(true);
  });


  it('sipariş listesinde RFQ başlığı ve satıcı teklif notu seçilir', async () => {
    await createService().list({
      role: Role.BUYER,
      companyId: 'buyer-1',
    });

    const select = findMany.mock.calls[0][0].select;

    expect(select.rfq.select.title).toBe(true);
    expect(select.quote.select.sellerNote).toBe(true);
    expect(select.iyzicoCheckoutToken).not.toBe(true);
    expect(select.iyzicoRawResult).not.toBe(true);
  });

  it('sipariş detayında RFQ başlığı ve satıcı teklif notu seçilir', async () => {
    await createService().getOne(
      { role: Role.BUYER, companyId: 'buyer-1' },
      'order-privacy-1',
    );

    const select = findUnique.mock.calls[0][0].select;

    expect(select.rfq.select.title).toBe(true);
    expect(select.quote.select.sellerNote).toBe(true);
    expect(select.iyzicoCheckoutToken).not.toBe(true);
    expect(select.iyzicoRawResult).not.toBe(true);
  });

});
