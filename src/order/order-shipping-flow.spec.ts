import { OrderStatus, Role } from '@prisma/client';
import { OrderService } from './order.service';

describe('OrderService satıcının kendi kargo / ambar gönderimi', () => {
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const findBuyer = jest.fn();
  const notify = jest.fn();
  const sendMail = jest.fn();

  const baseOrder = {
    id: 'order-shipping-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    status: OrderStatus.PREPARING,
  };

  let currentOrder: Record<string, any>;

  function createService() {
    return new OrderService(
      {
        order: { findUnique, updateMany },
        user: { findFirst: findBuyer },
      } as any,
      { createNotification: notify } as any,
      { sendMail } as any,
      {} as any,
    );
  }

  beforeEach(() => {
    jest.resetAllMocks();

    currentOrder = { ...baseOrder };

    findUnique.mockImplementation(async () => ({ ...currentOrder }));
    updateMany.mockImplementation(async ({ where, data }: any) => {
      if (
        where.id !== currentOrder.id ||
        where.sellerId !== currentOrder.sellerId ||
        where.status !== currentOrder.status
      ) {
        return { count: 0 };
      }

      currentOrder = { ...currentOrder, ...data };
      return { count: 1 };
    });

    findBuyer.mockResolvedValue({
      id: 'buyer-user-1',
      email: 'buyer@example.test',
    });
    notify.mockResolvedValue({});
    sendMail.mockResolvedValue({});
  });

  const cargo = {
    shippingMethod: 'CARGO' as const,
    shippingCompany: 'Örnek Kargo',
    shippingTrackingNo: 'KRG-123',
  };

  const freight = {
    shippingMethod: 'FREIGHT' as const,
    shippingCompany: 'Örnek Ambar',
    shippingTrackingNo: 'AMB-456',
    shippingDispatchNo: 'IRS-789',
  };

  it('kargo gönderimini kaydeder ve alıcıya bildirir', async () => {
    const result = await createService().ship(
      { role: Role.SELLER, companyId: 'seller-1' },
      baseOrder.id,
      cargo,
    );

    expect(result.order.status).toBe(OrderStatus.SHIPPED);
    expect(result.order.shippingMethod).toBe('CARGO');
    expect(result.order.shippingCompany).toBe('Örnek Kargo');
    expect(result.order.shippingTrackingNo).toBe('KRG-123');
    expect(result.order.shippedAt).toBeInstanceOf(Date);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].userId).toBe('buyer-user-1');
    expect(notify.mock.calls[0][0].title).toBe('Sipariş Kargoya Verildi');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('ambar fişi ve sevk irsaliyesini kaydeder', async () => {
    const result = await createService().ship(
      { role: Role.SELLER, companyId: 'seller-1' },
      baseOrder.id,
      freight,
    );

    expect(result.order).toMatchObject({
      status: OrderStatus.SHIPPED,
      shippingMethod: 'FREIGHT',
      shippingCompany: 'Örnek Ambar',
      shippingTrackingNo: 'AMB-456',
      shippingDispatchNo: 'IRS-789',
    });

    expect(notify.mock.calls[0][0].title)
      .toBe('Sipariş Ambar / Nakliyeye Verildi');
    expect(sendMail.mock.calls[0][0].subject)
      .toContain('ambar / nakliyeye verildi');
  });

  it('alıcı gönderim başlatamaz', async () => {
    await expect(createService().ship(
      { role: Role.BUYER, companyId: 'buyer-1' },
      baseOrder.id,
      cargo,
    )).rejects.toThrow();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('başka satıcı gönderim başlatamaz', async () => {
    await expect(createService().ship(
      { role: Role.SELLER, companyId: 'seller-other' },
      baseOrder.id,
      cargo,
    )).rejects.toThrow();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('hazırlanma aşamasında olmayan sipariş gönderilemez', async () => {
    currentOrder.status = OrderStatus.PAID;

    await expect(createService().ship(
      { role: Role.SELLER, companyId: 'seller-1' },
      baseOrder.id,
      cargo,
    )).rejects.toThrow();

    expect(updateMany).not.toHaveBeenCalled();
  });

  it('aynı sipariş ikinci kez gönderilemez', async () => {
    const service = createService();
    const seller = { role: Role.SELLER, companyId: 'seller-1' };

    await service.ship(seller, baseOrder.id, cargo);

    await expect(
      service.ship(seller, baseOrder.id, cargo),
    ).rejects.toThrow();

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('eşzamanlı durum değişikliğinde gönderim başarısız olur', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(createService().ship(
      { role: Role.SELLER, companyId: 'seller-1' },
      baseOrder.id,
      cargo,
    )).rejects.toThrow();

    expect(notify).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('bildirim hatası gönderilmiş siparişi geri almaz', async () => {
    notify.mockRejectedValue(new Error('Mock notification failure'));

    const result = await createService().ship(
      { role: Role.SELLER, companyId: 'seller-1' },
      baseOrder.id,
      cargo,
    );

    expect(result.order.status).toBe(OrderStatus.SHIPPED);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  describe.each([
    ['kargo', cargo],
    ['ambar', freight],
  ])('%s bildirim hata yönetimi', (_label, shipment) => {
    it('bildirim hatasında e-postayı doğru alıcıya gönderir', async () => {
      notify.mockRejectedValue(new Error('Mock notification failure'));

      const result = await createService().ship(
        { role: Role.SELLER, companyId: 'seller-1' },
        baseOrder.id,
        shipment,
      );

      expect(result.order.status).toBe(OrderStatus.SHIPPED);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls[0][0].to).toBe('buyer@example.test');
    });

    it('e-posta hatasında gönderimi ve uygulama bildirimini korur', async () => {
      sendMail.mockRejectedValue(new Error('Mock mail failure'));

      const result = await createService().ship(
        { role: Role.SELLER, companyId: 'seller-1' },
        baseOrder.id,
        shipment,
      );

      expect(result.order.status).toBe(OrderStatus.SHIPPED);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(updateMany).toHaveBeenCalledTimes(1);
    });

    it('iki kanal hata verse de gönderimi korur ve tekrarda bildirim üretmez', async () => {
      notify.mockRejectedValue(new Error('Mock notification failure'));
      sendMail.mockRejectedValue(new Error('Mock mail failure'));
      const service = createService();
      const seller = { role: Role.SELLER, companyId: 'seller-1' };

      const result = await service.ship(seller, baseOrder.id, shipment);
      expect(result.order.status).toBe(OrderStatus.SHIPPED);

      await expect(
        service.ship(seller, baseOrder.id, shipment),
      ).rejects.toThrow();

      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });
  });

  it('HTML özel karakterleri e-postada güvenli gösterilir', async () => {
    await createService().ship(
      { role: Role.SELLER, companyId: 'seller-1' },
      baseOrder.id,
      {
        ...cargo,
        shippingCompany: '<script>alert(1)</script>',
      },
    );

    const html = sendMail.mock.calls[0][0].html;

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
