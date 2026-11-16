import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ShippingService } from './shipping.service';

describe('Nakliye teklifi kabulü gizliliği', () => {
  const findUnique = jest.fn();
  const transaction = jest.fn();

  const tx = {
    shippingQuote: {
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    shippingRFQ: {
      updateMany: jest.fn(),
    },
    shippingOrder: {
      create: jest.fn(),
    },
    chatThread: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const service = new ShippingService({
    shippingQuote: { findUnique },
    $transaction: transaction,
  } as any);

  beforeEach(() => {
    jest.resetAllMocks();
    tx.shippingRFQ.updateMany.mockResolvedValue({ count: 1 });

    findUnique.mockResolvedValue({
      id: 'quote-1',
      rfqId: 'rfq-1',
      companyId: 'logistics-1',
      rfq: {
        id: 'rfq-1',
        buyerId: 'buyer-1',
        orderId: 'order-1',
        status: 'OPEN',
        order: { sellerId: 'seller-1' },
      },
    });

    tx.shippingOrder.create.mockResolvedValue({
      id: 'shipping-1',
      shippingCompany: 'Lojistik Firması',
    });

    tx.chatThread.findUnique.mockResolvedValue({
      id: 'chat-1',
    });

    transaction.mockImplementation(async (callback) => callback(tx));
  });

  it('firma özel bilgilerini sorgulamaz ve gerçek unvanı kaydetmez', async () => {
    await service.acceptQuote(
      { role: 'BUYER', companyId: 'buyer-1' },
      'quote-1',
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'quote-1' },
      select: {
        id: true,
        rfqId: true,
        companyId: true,
        rfq: {
          select: {
            id: true,
            buyerId: true,
            orderId: true,
            status: true,
            order: {
              select: { sellerId: true },
            },
          },
        },
      },
    });

    const data = tx.shippingOrder.create.mock.calls[0][0].data;

    expect(data.shippingCompany).toBe('Lojistik Firması');
    expect(data.logisticsId).toBe('logistics-1');
    expect(data.buyerId).toBe('buyer-1');
    expect(data.sellerId).toBe('seller-1');
    expect(data.shippingQuoteId).toBe('quote-1');
  });

  it('firma kimliği olmayan alıcıyı reddeder', async () => {
    await expect(
      service.acceptQuote({ role: 'BUYER' }, 'quote-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findUnique).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('başka alıcının teklifini kabul ettirmez', async () => {
    await expect(
      service.acceptQuote(
        { role: 'BUYER', companyId: 'other-buyer' },
        'quote-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('RFQ yalnızca açıkken atomik olarak kapatılır', async () => {
    await service.acceptQuote(
      { role: 'BUYER', companyId: 'buyer-1' },
      'quote-1',
    );

    expect(tx.shippingRFQ.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'rfq-1',
        buyerId: 'buyer-1',
        status: 'OPEN',
      },
      data: { status: 'CLOSED' },
    });
  });

  it('önceden kapatılmış RFQ için sipariş oluşturmaz', async () => {
    tx.shippingRFQ.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.acceptQuote(
        { role: 'BUYER', companyId: 'buyer-1' },
        'quote-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.shippingQuote.update).not.toHaveBeenCalled();
    expect(tx.shippingOrder.create).not.toHaveBeenCalled();
  });

  it('eşzamanlı iki kabulden yalnızca biri başarılı olur', async () => {
    let open = true;

    tx.shippingRFQ.updateMany.mockImplementation(async () => {
      if (!open) return { count: 0 };
      open = false;
      return { count: 1 };
    });

    const user = { role: 'BUYER', companyId: 'buyer-1' };

    const results = await Promise.allSettled([
      service.acceptQuote(user, 'quote-1'),
      service.acceptQuote(user, 'quote-1'),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);

    expect(tx.shippingOrder.create).toHaveBeenCalledTimes(1);
  });

  it('yalnızca gerekli kimlikleri döndürür', async () => {
    const result = await service.acceptQuote(
      { role: 'BUYER', companyId: 'buyer-1' },
      'quote-1',
    );

    expect(result).toEqual({
      message:
        'Nakliye firması seçildi, taşıma siparişi ve üç taraflı lojistik sohbeti oluşturuldu',
      shippingOrderId: 'shipping-1',
      chatThreadId: 'chat-1',
    });

    expect(result).not.toHaveProperty('shippingOrder');
    expect(result).not.toHaveProperty('chatThread');
  });
});
