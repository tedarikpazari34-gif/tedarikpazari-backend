import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { LedgerType, OrderStatus, Prisma, Role } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';
import { ShipOrderDto } from './dto/ship-order.dto';

@Injectable()
export class OrderService {
  constructor(
  private prisma: PrismaService,
  private notificationService: NotificationService,
  private mailService: MailService,
) {}

  private async ensureWallet(tx: Prisma.TransactionClient, companyId: string) {
    return tx.companyWallet.upsert({
      where: { companyId },
      create: {
        companyId,
        available: new Prisma.Decimal(0),
        locked: new Prisma.Decimal(0),
      },
      update: {},
    });
  }

  async createFromQuote(user: any, quoteId: string) {
    if (!user || user.role !== Role.BUYER) {
      throw new ForbiddenException('Sadece BUYER sipariş oluşturabilir');
    }

    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        rfq: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!quote) {
      throw new NotFoundException('Quote bulunamadı');
    }

    if (!quote.rfq) {
      throw new BadRequestException('Quote RFQ ilişkisi bulunamadı');
    }

    if (quote.rfq.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu teklif size ait değil');
    }

    if (quote.status !== 'SENT') {
      throw new BadRequestException('Bu teklif artık kullanılamaz');
    }

    if (quote.rfq.status !== 'OPEN') {
      throw new BadRequestException('RFQ açık değil');
    }

    const existingOrder = await this.prisma.order.findFirst({
      where: {
        OR: [{ rfqId: quote.rfqId }, { quoteId: quote.id }],
      },
    });

    if (existingOrder) {
      throw new BadRequestException(
        'Bu teklif için zaten sipariş oluşturulmuş',
      );
    }

    const totalAmount = new Prisma.Decimal(quote.unitPrice).mul(
      new Prisma.Decimal(quote.rfq.quantity),
    );

    const commissionAmount = totalAmount.mul(new Prisma.Decimal(0.05));
    const escrowAmount = totalAmount;
    const payoutAmount = totalAmount.minus(commissionAmount);

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          rfqId: quote.rfqId,
          quoteId: quote.id,
          buyerId: quote.rfq.buyerId,
          sellerId: quote.sellerId,
          totalAmount,
          commissionAmount,
          escrowAmount,
          payoutAmount,
          status: OrderStatus.PENDING_PAYMENT,
        },
      });

      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: 'ACCEPTED',
        },
      });

      await tx.quote.updateMany({
        where: {
          rfqId: quote.rfqId,
          id: { not: quote.id },
        },
        data: {
          status: 'REJECTED',
        },
      });

      await tx.rFQ.update({
        where: { id: quote.rfqId },
        data: {
          status: 'CLOSED',
        },
      });

      return {
        message: 'Order oluşturuldu',
        order,
      };
    });

    const sellerUser = await this.prisma.user.findFirst({
      where: { companyId: quote.sellerId },
    });

    if (sellerUser) {
      await this.notificationService.createNotification({
        userId: sellerUser.id,
        type: 'ORDER',
        title: 'Teklifiniz Kabul Edildi',
        message: `${quote.rfq.product?.title || 'Ürün'} için verdiğiniz teklif siparişe dönüştü.`,
        link: '/seller/orders',
      });
    }

    return result;
  }

  async list(user: any) {
    const includeRelations = {
      rfq: {
        include: {
          product: true,
        },
      },
      quote: true,
      buyer: true,
      seller: true,
    };

    if (user.role === Role.ADMIN) {
      return this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        include: includeRelations,
      });
    }

    if (user.role === Role.BUYER) {
      return this.prisma.order.findMany({
        where: {
          buyerId: user.companyId,
        },
        orderBy: { createdAt: 'desc' },
        include: includeRelations,
      });
    }

    if (user.role === Role.SELLER) {
      return this.prisma.order.findMany({
        where: {
          sellerId: user.companyId,
        },
        orderBy: { createdAt: 'desc' },
        include: includeRelations,
      });
    }

    throw new ForbiddenException('Yetkisiz');
  }

  async getOne(user: any, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        rfq: {
          include: {
            product: true,
          },
        },
        quote: true,
        buyer: true,
        seller: true,
        disputes: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const isAdmin = user.role === Role.ADMIN;

    const isOwner =
      order.buyerId === user.companyId || order.sellerId === user.companyId;

    if (!isAdmin && !isOwner) {
      throw new ForbiddenException('Bu order size ait değil');
    }

    return order;
  }

  async pay(user: any, orderId: string) {
  if (user.role !== Role.BUYER) {
    throw new ForbiddenException('Sadece BUYER ödeme yapabilir');
  }

  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  if (order.buyerId !== user.companyId) {
    throw new ForbiddenException('Bu order size ait değil');
  }

  if (order.status !== OrderStatus.PENDING_PAYMENT) {
    return {
      message: 'Order zaten ödeme aşamasını geçmiş',
      order,
    };
  }

  const escrowAmount = new Prisma.Decimal(order.escrowAmount);

  if (escrowAmount.lte(0)) {
    throw new BadRequestException('Escrow amount 0 olamaz');
  }

  const result = await this.prisma.$transaction(async (tx) => {
    await this.ensureWallet(tx, order.buyerId);
    await this.ensureWallet(tx, order.sellerId);

    const buyerWallet = await tx.companyWallet.findUnique({
      where: { companyId: order.buyerId },
    });

    if (!buyerWallet) {
      throw new NotFoundException('Buyer wallet not found');
    }

    const buyerAvailable = new Prisma.Decimal(
      buyerWallet.available,
    );

    if (buyerAvailable.lt(escrowAmount)) {
      throw new BadRequestException('Yetersiz bakiye');
    }

    await tx.companyWallet.update({
      where: { companyId: order.buyerId },
      data: {
        available: { decrement: escrowAmount },
        locked: { increment: escrowAmount },
      },
    });

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PAID },
    });

    await tx.ledgerEntry.create({
      data: {
        orderId: order.id,
        type: LedgerType.ESCROW_DEPOSIT,
        amount: escrowAmount,
        currency: 'TRY',
        note: 'Buyer payment deposited into escrow',
      },
    });

    await tx.ledgerEntry.create({
      data: {
        orderId: order.id,
        type: LedgerType.COMMISSION,
        amount: order.commissionAmount,
        currency: 'TRY',
        note: 'Platform commission reserved',
      },
    });

    return {
      message: 'Payment successful',
      order: updatedOrder,
    };
  });

  const sellerUser = await this.prisma.user.findFirst({
    where: { companyId: order.sellerId },
  });

  if (sellerUser) {
    await this.notificationService.createNotification({
      userId: sellerUser.id,
      type: 'PAYMENT',
      title: 'Ödeme Alındı',
      message:
        'Alıcı ödemeyi yaptı. Siparişi hazırlamaya başlayabilirsiniz.',
      link: '/seller/orders',
    });
  }

  return result;
}

  async prepare(user: any, orderId: string) {
  if (user.role !== Role.SELLER) {
    throw new ForbiddenException('Sadece SELLER hazırlayabilir');
  }

  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  if (order.sellerId !== user.companyId) {
    throw new ForbiddenException('Bu order size ait değil');
  }

  if (order.status !== OrderStatus.PAID) {
    throw new BadRequestException(
      `Order PAID değil. Mevcut status: ${order.status}`,
    );
  }

  const updated = await this.prisma.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.PREPARING },
  });

  const buyerUser = await this.prisma.user.findFirst({
    where: { companyId: order.buyerId },
  });

  if (buyerUser) {
    await this.notificationService.createNotification({
      userId: buyerUser.id,
      type: 'ORDER',
      title: 'Sipariş Hazırlanıyor',
      message: 'Siparişiniz satıcı tarafından hazırlanmaya alındı.',
      link: '/buyer/orders',
    });
  }

  return {
    message: 'Order marked as PREPARING',
    order: updated,
  };
}

async ship(user: any, orderId: string, body: ShipOrderDto) {
  if (user.role !== Role.SELLER) {
    throw new ForbiddenException('Sadece SELLER kargoya verebilir');
  }

  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  if (order.sellerId !== user.companyId) {
    throw new ForbiddenException('Bu order size ait değil');
  }

  if (order.status !== OrderStatus.PREPARING) {
    throw new BadRequestException(
      `Order PREPARING değil. Mevcut status: ${order.status}`,
    );
  }

  const updated = await this.prisma.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.SHIPPED,
      shippedAt: new Date(),
      shippingTrackingNo: body.shippingTrackingNo.trim(),
      shippingCompany: body.shippingCompany.trim(),
    },
  });

  try {
  const buyerUser = await this.prisma.user.findFirst({
    where: { companyId: order.buyerId },
  });

  if (buyerUser) {
    await this.notificationService.createNotification({
      userId: buyerUser.id,
      type: 'ORDER',
      title: 'Sipariş Kargoya Verildi',
      message: `${updated.shippingCompany || 'Kargo'} ile siparişiniz yola çıktı. Takip No: ${updated.shippingTrackingNo || '-'}`,
      link: '/buyer/orders',
    });
  }

  if (buyerUser?.email) {
    await this.mailService.sendMail({
      to: buyerUser.email,
      subject: 'Tedarik Pazarı - Siparişiniz kargoya verildi',
      text: `${updated.shippingCompany || 'Kargo'} ile siparişiniz yola çıktı. Takip No: ${updated.shippingTrackingNo || '-'}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6">
          <h2>Siparişiniz kargoya verildi</h2>
          <p>${updated.shippingCompany || 'Kargo'} ile siparişiniz yola çıktı.</p>
          <p><strong>Takip No:</strong> ${updated.shippingTrackingNo || '-'}</p>
          <p>Siparişinizi alıcı panelinizden takip edebilirsiniz.</p>
        </div>
      `,
    });
  }
} catch (err) {
  console.error('ship notification/mail failed', err);
}

  return {
    message: 'Order marked as SHIPPED',
    order: updated,
  };
}

async complete(user: any, orderId: string) {
  if (user.role !== Role.BUYER) {
    throw new ForbiddenException('Sadece BUYER tamamlayabilir');
  }

  const order = await this.prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new NotFoundException('Order not found');
  }

  if (order.buyerId !== user.companyId) {
    throw new ForbiddenException('Bu order size ait değil');
  }

  if (order.status !== OrderStatus.SHIPPED) {
    throw new BadRequestException(
      `Order SHIPPED değil. Mevcut status: ${order.status}`,
    );
  }

  if (order.escrowReleased) {
    throw new BadRequestException('Escrow zaten serbest bırakılmış');
  }

  const result = await this.prisma.$transaction(async (tx) => {
    await this.ensureWallet(tx, order.buyerId);
    await this.ensureWallet(tx, order.sellerId);

    const escrowAmount = new Prisma.Decimal(order.escrowAmount);
    const payoutAmount = new Prisma.Decimal(order.payoutAmount);

    const buyerWallet = await tx.companyWallet.findUnique({
      where: { companyId: order.buyerId },
    });

    if (!buyerWallet) {
      throw new NotFoundException('Buyer wallet not found');
    }

    if (new Prisma.Decimal(buyerWallet.locked).lt(escrowAmount)) {
      throw new BadRequestException('Buyer locked bakiye yetersiz');
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.COMPLETED,
        escrowReleased: true,
        releasedAt: new Date(),
      },
    });

    await tx.companyWallet.update({
      where: { companyId: order.buyerId },
      data: {
        locked: { decrement: escrowAmount },
      },
    });

    await tx.companyWallet.update({
      where: { companyId: order.sellerId },
      data: {
        available: { increment: payoutAmount },
      },
    });

    await tx.ledgerEntry.create({
      data: {
        orderId: order.id,
        type: LedgerType.ESCROW_RELEASE_SELLER,
        amount: payoutAmount,
        currency: 'TRY',
        note: 'Escrow released to seller after commission deduction',
      },
    });

   return {
      message: 'Order completed and escrow released',
      order: updated,
    };
  });

  try {
    const sellerUser = await this.prisma.user.findFirst({
      where: { companyId: order.sellerId },
    });

    if (sellerUser) {
      await this.notificationService.createNotification({
        userId: sellerUser.id,
        type: 'ORDER',
        title: 'Sipariş Tamamlandı',
        message:
          'Alıcı siparişi teslim aldığını onayladı. Tutar bakiyenize aktarıldı.',
        link: '/seller/orders',
      });
    }

    if (sellerUser?.email) {
      await this.mailService.sendMail({
        to: sellerUser.email,
        subject: 'Tedarik Pazarı - Sipariş tamamlandı',
        text: 'Alıcı siparişi teslim aldığını onayladı. Tutar bakiyenize aktarıldı.',
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>Sipariş tamamlandı</h2>
            <p>Alıcı siparişi teslim aldığını onayladı.</p>
            <p>Tutar bakiyenize aktarıldı.</p>
          </div>
        `,
      });
    }
  } catch (err) {
    console.error('complete notification/mail failed', err);
  }

  return result;
}
}