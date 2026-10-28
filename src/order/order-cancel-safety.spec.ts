import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';
import { IyzicoService } from '../payments/iyzico.service';
import { OrderService } from './order.service';

describe('Order cancellation safety', () => {
  const findOrder = jest.fn();
  const findExpiredOrders = jest.fn();
  const findAttempt = jest.fn();
  const updateOrder = jest.fn();
  const findUpdatedOrder = jest.fn();
  const advisoryLock = jest.fn();
  const releaseProductStock = jest.fn();
  const releaseVariantStock = jest.fn();

  const tx = {
    $queryRaw: advisoryLock,
    order: {
      findUnique: findOrder,
      updateMany: updateOrder,
      findUniqueOrThrow: findUpdatedOrder,
    },
    paymentAttempt: { findFirst: findAttempt },
    product: { updateMany: releaseProductStock },
    productVariant: { updateMany: releaseVariantStock },
  };

  const prisma = {
    order: { findMany: findExpiredOrders },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx)),
  };

  const service = new OrderService(
    prisma as unknown as PrismaService,
    {} as NotificationService,
    {} as MailService,
    {} as IyzicoService,
  );

  const cancel = (user: { role: string; companyId: string } = {
    role: 'BUYER',
    companyId: 'buyer-1',
  }) => service.cancel(user, 'order-1');

  const reservedOrder = (variantId: string | null) => ({
    id: 'order-1',
    buyerId: 'buyer-1',
    status: OrderStatus.PENDING_PAYMENT,
    iyzicoPaymentId: null,
    iyzicoPaidAt: null,
    productId: 'product-1',
    variantId,
    quantity: 5,
    stockReservationStatus: 'RESERVED',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findExpiredOrders.mockResolvedValue([]);
    findOrder.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      status: OrderStatus.PENDING_PAYMENT,
      iyzicoPaymentId: null,
      iyzicoPaidAt: null,
    });
    findAttempt.mockResolvedValue(null);
    updateOrder.mockResolvedValue({ count: 1 });
    releaseProductStock.mockResolvedValue({ count: 1 });
    releaseVariantStock.mockResolvedValue({ count: 1 });
    findUpdatedOrder.mockResolvedValue({
      id: 'order-1',
      status: OrderStatus.CANCELLED,
    });
  });

  it('satıcı sipariş iptal edemez', async () => {
    await expect(cancel({
      role: 'SELLER',
      companyId: 'seller-1',
    })).rejects.toThrow(ForbiddenException);

    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('başka alıcının siparişi iptal edilemez', async () => {
    await expect(cancel({
      role: 'BUYER',
      companyId: 'other-buyer',
    })).rejects.toThrow(ForbiddenException);

    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('ödenmiş sipariş iptal edilemez', async () => {
    findOrder.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      status: OrderStatus.PAID,
    });

    await expect(cancel()).rejects.toThrow(BadRequestException);
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it.each([
    PaymentStatus.INITIATED,
    PaymentStatus.CALLBACK_RECEIVED,
    PaymentStatus.REVIEW,
    PaymentStatus.SUCCESS,
  ])('%s ödeme denemesi varken iptal engellenir', async () => {
    findAttempt.mockResolvedValue({ id: 'attempt-1' });

    await expect(cancel()).rejects.toThrow(BadRequestException);
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('ödeme kaydı varsa bekleyen sipariş de iptal edilemez', async () => {
    findOrder.mockResolvedValue({
      id: 'order-1',
      buyerId: 'buyer-1',
      status: OrderStatus.PENDING_PAYMENT,
      iyzicoPaymentId: 'payment-1',
      iyzicoPaidAt: null,
    });

    await expect(cancel()).rejects.toThrow(BadRequestException);
    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('yalnızca başarısız denemeler kaldığında koşullu iptal yapılır', async () => {
    await expect(cancel()).resolves.toMatchObject({
      status: OrderStatus.CANCELLED,
    });

    expect(advisoryLock).toHaveBeenCalledTimes(1);
    expect(findAttempt).toHaveBeenCalledWith({
      where: {
        orderId: 'order-1',
        status: { not: PaymentStatus.FAILED },
      },
      select: { id: true },
    });
    expect(updateOrder).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: OrderStatus.PENDING_PAYMENT,
      },
      data: { status: OrderStatus.CANCELLED },
    });
  });

  it('varyant rezervasyonu güvenli iptalde serbest bırakılır', async () => {
    findOrder.mockResolvedValue(reservedOrder('variant-1'));

    await expect(cancel()).resolves.toMatchObject({
      status: OrderStatus.CANCELLED,
    });

    expect(updateOrder).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: OrderStatus.PENDING_PAYMENT,
      },
      data: {
        status: OrderStatus.CANCELLED,
        stockReservationStatus: 'RELEASED',
      },
    });

    expect(releaseVariantStock).toHaveBeenCalledWith({
      where: {
        id: 'variant-1',
        productId: 'product-1',
        reservedQuantity: { gte: 5 },
      },
      data: {
        reservedQuantity: { decrement: 5 },
      },
    });

    expect(releaseProductStock).not.toHaveBeenCalled();
  });

  it('normal ürün rezervasyonu güvenli iptalde serbest bırakılır', async () => {
    findOrder.mockResolvedValue(reservedOrder(null));

    await cancel();

    expect(releaseProductStock).toHaveBeenCalledWith({
      where: {
        id: 'product-1',
        reservedQuantity: { gte: 5 },
      },
      data: {
        reservedQuantity: { decrement: 5 },
      },
    });

    expect(releaseVariantStock).not.toHaveBeenCalled();
  });

  it('rezervasyon miktarı doğrulanamazsa iptal hata verir', async () => {
    findOrder.mockResolvedValue(reservedOrder('variant-1'));
    releaseVariantStock.mockResolvedValue({ count: 0 });

    await expect(cancel()).rejects.toThrow(
      'Stok rezervasyonu güvenle serbest bırakılamadı',
    );

    expect(releaseVariantStock).toHaveBeenCalledTimes(1);
    expect(findUpdatedOrder).not.toHaveBeenCalled();
  });

  it('iptal yarışı kaybedilirse stok ikinci kez serbest bırakılmaz', async () => {
    findOrder.mockResolvedValue(reservedOrder('variant-1'));
    updateOrder.mockResolvedValue({ count: 0 });

    await expect(cancel()).rejects.toThrow('Sipariş durumu değişti');

    expect(releaseVariantStock).not.toHaveBeenCalled();
    expect(releaseProductStock).not.toHaveBeenCalled();
  });

  it('önceden serbest bırakılmış rezervasyon yeniden iade edilmez', async () => {
    findOrder.mockResolvedValue({
      ...reservedOrder('variant-1'),
      stockReservationStatus: 'RELEASED',
    });

    await expect(cancel()).rejects.toThrow(BadRequestException);

    expect(updateOrder).not.toHaveBeenCalled();
    expect(releaseVariantStock).not.toHaveBeenCalled();
  });


  it('otomatik iptal yalnızca 30 dakikayı aşan uygun rezervasyonları arar', async () => {
    await service.expireUnpaidReservations();

    expect(findExpiredOrders).toHaveBeenCalledWith({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        stockReservationStatus: 'RESERVED',
        createdAt: { lte: expect.any(Date) },
        iyzicoPaymentId: null,
        iyzicoPaidAt: null,
        paymentAttempts: {
          none: {
            status: { not: PaymentStatus.FAILED },
          },
        },
      },
      select: { id: true, buyerId: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    expect(updateOrder).not.toHaveBeenCalled();
  });

  it('süresi dolan rezervasyon güvenli şekilde serbest bırakılır', async () => {
    findExpiredOrders.mockResolvedValue([
      { id: 'order-1', buyerId: 'buyer-1' },
    ]);
    findOrder.mockResolvedValue(reservedOrder('variant-1'));

    await service.expireUnpaidReservations();

    expect(advisoryLock).toHaveBeenCalledTimes(1);
    expect(updateOrder).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: OrderStatus.PENDING_PAYMENT,
      },
      data: {
        status: OrderStatus.CANCELLED,
        stockReservationStatus: 'RELEASED',
      },
    });
    expect(releaseVariantStock).toHaveBeenCalledTimes(1);
  });

  it('ödeme denemesi oluşmuşsa otomatik iptal stok serbest bırakmaz', async () => {
    findExpiredOrders.mockResolvedValue([
      { id: 'order-1', buyerId: 'buyer-1' },
    ]);
    findOrder.mockResolvedValue(reservedOrder('variant-1'));
    findAttempt.mockResolvedValue({ id: 'attempt-1' });

    await service.expireUnpaidReservations();

    expect(updateOrder).not.toHaveBeenCalled();
    expect(releaseVariantStock).not.toHaveBeenCalled();
  });

  it('sipariş ödeme sırasında değişmişse otomatik iptal stok serbest bırakmaz', async () => {
    findExpiredOrders.mockResolvedValue([
      { id: 'order-1', buyerId: 'buyer-1' },
    ]);
    findOrder.mockResolvedValue({
      ...reservedOrder(null),
      status: OrderStatus.PAID,
    });

    await service.expireUnpaidReservations();

    expect(updateOrder).not.toHaveBeenCalled();
    expect(releaseProductStock).not.toHaveBeenCalled();
  });

  it('eşzamanlı durum değişikliğinde iptal başarısız olur', async () => {
    updateOrder.mockResolvedValue({ count: 0 });

    await expect(cancel()).rejects.toThrow(
      'Sipariş durumu değişti',
    );

    expect(findUpdatedOrder).not.toHaveBeenCalled();
  });
});
