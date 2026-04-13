// src/payments/payments.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LedgerType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { IyzicoService } from './iyzico.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly iyzico: IyzicoService,
  ) {}

  // ✅ Wallet yoksa oluştur
  private async ensureWallet(tx: any, companyId: string) {
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

  /**
   * BUYER -> IyziCo checkout başlat
   * - Order PENDING_PAYMENT olmalı
   * - PaymentAttempt kaydı açar (token, conversationId vb.)
   */
  async initializeIyzico(user: any, orderId: string, clientIp?: string) {
    if (user.role !== Role.BUYER) {
      throw new ForbiddenException('Sadece BUYER ödeme başlatabilir');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        rfq: { include: { product: true } },
        buyer: true,
        seller: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    if (order.buyerId !== user.companyId) {
      throw new ForbiddenException('Bu order size ait değil');
    }

    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Order ödeme beklemiyor');
    }

    const conversationId = `ord_${order.id}_${Date.now()}`;

    const callbackUrl =
      process.env.IYZICO_CALLBACK_URL ||
      'http://localhost:3002/api/payments/iyzico/callback';

    // ⚠️ Demo placeholder: Üretimde buyer/address alanlarını gerçek veriden dolduracağız.
    const request: any = {
      locale: 'tr',
      conversationId,
      price: order.totalAmount.toString(),
      paidPrice: order.totalAmount.toString(),
      currency: 'TRY',
      basketId: order.id, // ✅ en kritik alan: callback sonrası order bulmak için
      paymentGroup: 'PRODUCT',
      callbackUrl,

      buyer: {
        id: order.buyerId,
        name: order.buyer?.name ?? 'Buyer',
        surname: 'Company',
        gsmNumber: '+905350000000',
        email: order.buyer?.email ?? 'buyer@example.com',
        identityNumber: '11111111111',
        registrationAddress: 'Istanbul',
        ip: clientIp || '85.34.78.112',
        city: 'Istanbul',
        country: 'Turkey',
      },

      shippingAddress: {
        contactName: order.buyer?.name ?? 'Buyer Co',
        city: 'Istanbul',
        country: 'Turkey',
        address: 'Istanbul',
        zipCode: '34000',
      },

      billingAddress: {
        contactName: order.buyer?.name ?? 'Buyer Co',
        city: 'Istanbul',
        country: 'Turkey',
        address: 'Istanbul',
        zipCode: '34000',
      },

      basketItems: [
        {
          id: order.rfq?.product?.id ?? order.id,
          name: order.rfq?.product?.title ?? 'Order Item',
          category1: 'B2B',
          itemType: 'PHYSICAL',
          price: order.totalAmount.toString(),
        },
      ],
    };

    const result = await this.iyzico.createCheckoutFormInitialize(request);

    if (!result || result.status !== 'success') {
      throw new BadRequestException(
        result?.errorMessage || 'Iyzico initialize failed',
      );
    }

    // ✅ PaymentAttempt kaydı aç (token/order bağını burada tutuyoruz)
    await this.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.IYZICO,
        status: PaymentStatus.INITIATED,
        conversationId,
        checkoutToken: result.token ?? null,
        rawRequest: request,
        rawResponse: result,
      },
    });

    // (Opsiyonel) Order üzerinde de debug alanı tutmak istersen:
    // await this.prisma.order.update({ where:{id:order.id}, data:{ iyzicoConversationId: conversationId } });

    return {
      message: 'iyzico init ok',
      orderId: order.id,
      conversationId,
      token: result.token,
      checkoutFormContent: result.checkoutFormContent,
    };
  }

  /**
   * Callback sonrası token ile sonucu doğrula (debug endpoint için de kullanılabilir)
   */
  async verifyIyzicoCheckout(token: string) {
    if (!token?.trim()) throw new BadRequestException('token zorunlu');

    const result = await this.iyzico.retrieveCheckoutForm(token.trim());

    return {
      message: 'iyzico verify ok',
      result,
    };
  }

  /**
   * IyziCo callback:
   * IyziCo genelde body: { token: "..." } gönderir.
   * - token ile retrieveCheckoutForm yap
   * - result.basketId -> orderId (en sağlam)
   * - order status PAID yap + wallet/ledger işlemleri
   */
  async handleIyzicoCallback(token: string) {
    if (!token?.trim()) {
      throw new BadRequestException('token zorunlu');
    }

    const result: any = await this.iyzico.retrieveCheckoutForm(token.trim());

    if (!result || result.status !== 'success') {
      throw new BadRequestException(
        result?.errorMessage || 'IyziCo ödeme başarısız',
      );
    }

    // ✅ Iyzipay retrieve result çoğunlukla basketId döner
    const orderId = (result.basketId || '').toString().trim();
    if (!orderId) {
      // BasketId yoksa alternatif: PaymentAttempt üzerinden token ile order bul
      const attempt = await this.prisma.paymentAttempt.findFirst({
        where: { checkoutToken: token.trim() },
      });
      if (!attempt) {
        throw new BadRequestException('basketId yok ve token eşleşmesi bulunamadı');
      }
      return this.processSuccessfulPayment(attempt.orderId, token.trim(), result);
    }

    return this.processSuccessfulPayment(orderId, token.trim(), result);
  }

  /**
   * Ödeme başarılıysa tek noktadan işle
   * - idempotent: order zaten PAID ise tekrar yapma
   */
  private async processSuccessfulPayment(
    orderId: string,
    token: string,
    result: any,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    // ✅ idempotency
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      // attempt'i yine de güncelleyelim
      await this.prisma.paymentAttempt.updateMany({
        where: { checkoutToken: token },
        data: { status: PaymentStatus.SUCCESS, rawResponse: result },
      });

      return { message: 'Order zaten işlenmiş', orderId: order.id, status: order.status };
    }

    const escrowAmount = new Prisma.Decimal(order.escrowAmount);
    if (escrowAmount.lte(0)) {
      throw new BadRequestException('Escrow amount 0 olamaz');
    }

    return this.prisma.$transaction(async (tx) => {
      // wallet ensure
      await this.ensureWallet(tx, order.buyerId);
      await this.ensureWallet(tx, order.sellerId);

      // ✅ buyer locked += escrow
      await tx.companyWallet.update({
        where: { companyId: order.buyerId },
        data: { locked: { increment: escrowAmount } },
      });

      // ✅ Order -> PAID
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.PAID,
          iyzicoConversationId: result.conversationId ?? null,
          iyzicoPaymentId: result.paymentId ?? null,
          iyzicoPaidAt: new Date(),
          iyzicoRawResult: result,
        },
      });

      // ✅ PaymentAttempt SUCCESS
      await tx.paymentAttempt.updateMany({
        where: { orderId: order.id, checkoutToken: token },
        data: {
          status: PaymentStatus.SUCCESS,
          iyzicoPaymentId: result.paymentId ?? null,
          rawResponse: result,
        },
      });

      // ✅ Ledger entries
      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          type: LedgerType.ESCROW_DEPOSIT,
          amount: escrowAmount,
          currency: 'TRY',
          note: 'IyziCo payment deposited into escrow',
          meta: { token },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          type: LedgerType.COMMISSION,
          amount: order.commissionAmount,
          currency: 'TRY',
          note: 'Platform commission reserved',
          meta: { token },
        },
      });

      return {
        message: 'Payment verified and order marked as PAID',
        order: updatedOrder,
      };
    });
  }
}