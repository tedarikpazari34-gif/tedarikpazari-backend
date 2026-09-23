// src/payments/payments.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CompanyStatus,
  LedgerType,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  Role,
} from '@prisma/client';
import { IyzicoService } from './iyzico.service';
import { NotificationService } from '../notification/notification.service';
import { SensitiveDataService } from '../common/security/sensitive-data.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly iyzico: IyzicoService,
    private readonly notificationService: NotificationService,
    private readonly sensitiveData: SensitiveDataService,
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

  private safeIyzicoResult(result: any) {
    if (!result || typeof result !== 'object') {
      return null;
    }

    return {
      status: result.status ?? null,
      paymentStatus: result.paymentStatus ?? null,
      paymentId: result.paymentId ?? null,
      conversationId: result.conversationId ?? null,
      basketId: result.basketId ?? null,
      price: result.price ?? null,
      paidPrice: result.paidPrice ?? null,
      currency: result.currency ?? null,
      fraudStatus: result.fraudStatus ?? null,
      itemTransactions: Array.isArray(result.itemTransactions)
        ? result.itemTransactions.map((item: any) => ({
            itemId: item.itemId ?? null,
            paymentTransactionId: item.paymentTransactionId ?? null,
            transactionStatus: item.transactionStatus ?? null,
            price: item.price ?? null,
            paidPrice: item.paidPrice ?? null,
          }))
        : [],
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
      errorGroup: result.errorGroup ?? null,
    };
  }

  private getExpectedBasketItemId(rawRequest: Prisma.JsonValue | null) {
    if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
      return null;
    }

    const basketItems = (rawRequest as Prisma.JsonObject).basketItems;

    if (!Array.isArray(basketItems) || basketItems.length !== 1) {
      return null;
    }

    const item = basketItems[0];

    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const itemId = (item as Prisma.JsonObject).id;

    return typeof itemId === 'string' && itemId.trim()
      ? itemId.trim()
      : null;
  }

  private async markPaymentAttemptSuccess(
    tx: Prisma.TransactionClient,
    paymentAttemptId: string,
    result: any,
    iyzicoPaymentId: string,
  ) {
    const safeResult = this.safeIyzicoResult(result);

    const transitioned = await tx.paymentAttempt.updateMany({
      where: {
        id: paymentAttemptId,
        OR: [
          {
            status: {
              notIn: [PaymentStatus.SUCCESS, PaymentStatus.FAILED],
            },
          },
          {
            status: PaymentStatus.SUCCESS,
            iyzicoPaymentId,
          },
        ],
      },
      data: {
        status: PaymentStatus.SUCCESS,
        iyzicoPaymentId,
        rawResponse: safeResult,
      },
    });

    if (transitioned.count === 0) {
      const attempt = await tx.paymentAttempt.findUnique({
        where: { id: paymentAttemptId },
      });

      if (!attempt) {
        throw new BadRequestException('Ödeme denemesi bulunamadı');
      }

      throw new BadRequestException(
        'Ödeme denemesi SUCCESS durumuna güvenli şekilde geçirilemedi; mutabakat gerekli',
      );
    }

    await tx.paymentAttempt.updateMany({
      where: {
        id: paymentAttemptId,
        status: PaymentStatus.SUCCESS,
        iyzicoPaymentId,
        succeededAt: null,
      },
      data: {
        succeededAt: new Date(),
      },
    });
  }

  private async markPaymentAttemptFailed(
    paymentAttemptId: string,
    result: any,
    iyzicoPaymentId?: string,
  ) {
    const safeResult = this.safeIyzicoResult(result);

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.updateMany({
        where: {
          id: paymentAttemptId,
          status: {
            in: [
              PaymentStatus.INITIATED,
              PaymentStatus.CALLBACK_RECEIVED,
              PaymentStatus.REVIEW,
            ],
          },
          failedAt: null,
        },
        data: {
          failedAt: new Date(),
        },
      });

      const transitioned = await tx.paymentAttempt.updateMany({
        where: {
          id: paymentAttemptId,
          status: {
            in: [
              PaymentStatus.INITIATED,
              PaymentStatus.CALLBACK_RECEIVED,
              PaymentStatus.REVIEW,
            ],
          },
        },
        data: {
          status: PaymentStatus.FAILED,
          ...(iyzicoPaymentId ? { iyzicoPaymentId } : {}),
          rawResponse: safeResult,
        },
      });

      if (transitioned.count === 0) {
        throw new BadRequestException(
          'Başarılı ödeme denemesi başarısız duruma çevrilemez; mutabakat gerekli',
        );
      }
    });
  }

  private async markPaymentAttemptReview(
    paymentAttemptId: string,
    result: any,
    iyzicoPaymentId: string,
  ) {
    const safeResult = this.safeIyzicoResult(result);

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentAttempt.updateMany({
        where: {
          id: paymentAttemptId,
          status: {
            in: [
              PaymentStatus.INITIATED,
              PaymentStatus.CALLBACK_RECEIVED,
              PaymentStatus.REVIEW,
            ],
          },
          reviewedAt: null,
        },
        data: {
          reviewedAt: new Date(),
        },
      });

      const transitioned = await tx.paymentAttempt.updateMany({
        where: {
          id: paymentAttemptId,
          status: {
            in: [
              PaymentStatus.INITIATED,
              PaymentStatus.CALLBACK_RECEIVED,
              PaymentStatus.REVIEW,
            ],
          },
        },
        data: {
          status: PaymentStatus.REVIEW,
          iyzicoPaymentId,
          rawResponse: safeResult,
        },
      });

      if (transitioned.count === 0) {
        throw new BadRequestException(
          'Başarılı ödeme denemesi inceleme durumuna çevrilemez; mutabakat gerekli',
        );
      }
    });
  }

  async createIyzicoSubMerchant(
    user: any,
    body: { iban?: string; identityNumber?: string },
  ) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException(
        'Sadece SELLER iyzico ödeme hesabı oluşturabilir',
      );
    }

    const authenticatedUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { company: true },
    });

    if (!authenticatedUser || !authenticatedUser.company) {
      throw new ForbiddenException('Kullanıcı veya firma bulunamadı');
    }

    if (!authenticatedUser.emailVerified) {
      throw new ForbiddenException(
        'E-posta adresinizi doğrulamadan iyzico ödeme hesabı oluşturamazsınız',
      );
    }

    const company = authenticatedUser.company;

    if (company.status !== CompanyStatus.APPROVED) {
      throw new ForbiddenException(
        'Firmanız onaylanmadan iyzico ödeme hesabı oluşturamazsınız',
      );
    }

    if (!company.verified) {
      throw new ForbiddenException(
        'Firma doğrulaması tamamlanmadan iyzico ödeme hesabı oluşturamazsınız',
      );
    }

    if (company.iyzicoSubMerchantKey) {
      throw new BadRequestException(
        'Bu şirket için iyzico ödeme hesabı zaten oluşturulmuş',
      );
    }

    const country = (company.country || '').trim().toLocaleLowerCase('tr-TR');
    if (!['türkiye', 'turkiye', 'turkey', 'tr'].includes(country)) {
      throw new BadRequestException(
        'Yabancı şirketler için iyzico Marketplace kaydı henüz desteklenmiyor',
      );
    }

    const addressData =
      company.address &&
      typeof company.address === 'object' &&
      !Array.isArray(company.address)
        ? (company.address as Record<string, unknown>)
        : {};

    const companyType = String(addressData.companyType || '').trim();
    const streetAddress = String(addressData.address || '').trim();
    const district = String(addressData.district || '').trim();
    const fullName = String(addressData.fullName || '').trim();
    const fullNameParts = fullName.split(/\s+/).filter(Boolean);

    if (fullNameParts.length < 2) {
      throw new BadRequestException(
        'iyzico kaydı için yetkili kişinin adı ve soyadı eksiksiz olmalıdır',
      );
    }

    const contactSurname = fullNameParts[fullNameParts.length - 1];
    const contactName = fullNameParts.slice(0, -1).join(' ');

    if (!['Şahıs', 'Limited', 'Anonim'].includes(companyType)) {
      throw new BadRequestException(
        'Şirket türü iyzico Marketplace kaydı için uygun değil',
      );
    }

    const iban = String(body?.iban || '')
      .replace(/\s+/g, '')
      .toUpperCase();

    if (!/^TR\d{24}$/.test(iban)) {
      throw new BadRequestException('Geçerli bir Türkiye IBAN giriniz');
    }

    const identityNumber =
      this.sensitiveData.decrypt(company.paymentIdentityNumber) ||
      String(body?.identityNumber || '').trim();

    if (companyType === 'Şahıs' && !/^\d{11}$/.test(identityNumber)) {
      throw new BadRequestException(
        'Şahıs şirketi için 11 haneli T.C. kimlik numarası gereklidir',
      );
    }

    if (
      !company.name ||
      !company.email ||
      !company.phone ||
      !company.taxOffice ||
      !streetAddress ||
      !company.city
    ) {
      throw new BadRequestException(
        'iyzico kaydı için şirket iletişim, adres ve vergi bilgileri eksiksiz olmalıdır',
      );
    }

    if (
      ['Limited', 'Anonim'].includes(companyType) &&
      !company.taxNumber
    ) {
      throw new BadRequestException(
        'Limited ve Anonim şirketler için vergi numarası gereklidir',
      );
    }

    const fullAddress = [streetAddress, district, company.city]
      .filter(Boolean)
      .join(', ');

    const request: any = {
      locale: 'tr',
      conversationId: `submerchant_${company.id}_${Date.now()}`,
      subMerchantExternalId: company.id,
      subMerchantType:
        companyType === 'Şahıs'
          ? 'PRIVATE_COMPANY'
          : 'LIMITED_OR_JOINT_STOCK_COMPANY',
      address: fullAddress,
      contactName,
      contactSurname,
      taxOffice: company.taxOffice,
      legalCompanyTitle: company.name,
      email: company.email,
      gsmNumber: company.phone,
      name: company.name,
      iban,
      currency: 'TRY',
    };

    if (companyType === 'Şahıs') {
      request.identityNumber = identityNumber;
    } else {
      request.taxNumber = company.taxNumber;
    }

    const result = await this.iyzico.createSubMerchant(request);

    if (result?.status !== 'success' || !result?.subMerchantKey) {
      throw new BadRequestException(
        'IyziCo ödeme hesabı oluşturulamadı',
      );
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: {
        iyzicoSubMerchantKey: result.subMerchantKey,
      },
    });

    return {
      success: true,
      message: 'iyzico ödeme hesabı başarıyla oluşturuldu',
    };
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

    const authenticatedUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: { company: true },
    });

    if (!authenticatedUser || !authenticatedUser.company) {
      throw new ForbiddenException('Kullanıcı veya firma bulunamadı');
    }

    if (!authenticatedUser.emailVerified) {
      throw new ForbiddenException(
        'E-posta adresinizi doğrulamadan ödeme başlatamazsınız',
      );
    }

    if (authenticatedUser.company.status !== CompanyStatus.APPROVED) {
      throw new ForbiddenException(
        'Firmanız onaylanmadan ödeme başlatamazsınız',
      );
    }

    if (!authenticatedUser.company.verified) {
      throw new ForbiddenException(
        'Firma doğrulaması tamamlanmadan ödeme başlatamazsınız',
      );
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        rfq: { include: { product: true } },
        product: {
          include: {
            category: {
              include: {
                parent: true,
              },
            },
          },
        },
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

    if (!order.seller?.iyzicoSubMerchantKey) {
      throw new BadRequestException(
        'Satıcının iyzico Marketplace ödeme hesabı henüz oluşturulmamış',
      );
    }

    if (!clientIp || clientIp.trim() === '') {
      throw new BadRequestException('Ödeme için istemci IP adresi alınamadı');
    }

    const conversationId = `ord_${order.id}_${Date.now()}`;

    const callbackUrl = process.env.IYZICO_CALLBACK_URL?.trim();

    if (!callbackUrl) {
      throw new InternalServerErrorException(
        'iyzico callback yapılandırması eksik',
      );
    }

    const buyerAddressData =
      order.buyer?.address &&
      typeof order.buyer.address === 'object' &&
      Array.isArray(order.buyer.address) === false
        ? (order.buyer.address as Record<string, unknown>)
        : {};

    const buyerStreetAddress = String(buyerAddressData.address || '').trim();
    const buyerDistrict = String(buyerAddressData.district || '').trim();
    const buyerPostalCode = String(buyerAddressData.postalCode || '').trim();
    const buyerCompanyType = String(buyerAddressData.companyType || '').trim();
    const buyerFullName = String(buyerAddressData.fullName || '').trim();
    const buyerNameParts = buyerFullName.split(/\s+/).filter(Boolean);
    const buyerSurname = buyerNameParts[buyerNameParts.length - 1];
    const buyerName = buyerNameParts.slice(0, -1).join(' ');

    if (!buyerName || !buyerSurname) {
      throw new BadRequestException('Ödeme için yetkili kişinin adı ve soyadı eksiksiz olmalıdır');
    }

    const buyerIdentityNumber =
      this.sensitiveData.decrypt(order.buyer.paymentIdentityNumber) || '';

    if (!/^\d{11}$/.test(buyerIdentityNumber)) {
      throw new BadRequestException(
        buyerCompanyType === 'Şahıs'
          ? 'Ödeme için T.C. kimlik numarası eksik veya geçersizdir'
          : 'Ödeme için yetkili kişinin T.C. kimlik numarası eksik veya geçersizdir',
      );
    }

    if (
      !order.buyer?.email ||
      !order.buyer?.phone ||
      !buyerStreetAddress ||
      !buyerDistrict ||
      !order.buyer?.city ||
      !order.buyer?.country ||
      !buyerPostalCode
    ) {
      throw new BadRequestException(
        'Ödeme için alıcı iletişim ve adres bilgileri eksiksiz olmalıdır',
      );
    }

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
        name: buyerName,
        surname: buyerSurname,
        gsmNumber: order.buyer.phone,
        email: order.buyer.email,
        identityNumber: buyerIdentityNumber,
        registrationAddress: [buyerStreetAddress, buyerDistrict]
          .filter(Boolean)
          .join(', '),
        ip: clientIp,
        city: order.buyer.city,
        country: order.buyer.country,
        zipCode: buyerPostalCode,
      },

      shippingAddress: {
        contactName: buyerFullName,
        city: order.buyer.city,
        country: order.buyer.country,
        address: [buyerStreetAddress, buyerDistrict].filter(Boolean).join(', '),
        zipCode: buyerPostalCode,
      },

      billingAddress: {
        contactName: buyerFullName,
        city: order.buyer.city,
        country: order.buyer.country,
        address: [buyerStreetAddress, buyerDistrict].filter(Boolean).join(', '),
        zipCode: buyerPostalCode,
      },

      basketItems: [
        {
          id: order.product?.id ?? order.rfq?.product?.id ?? order.id,
          name:
            order.product?.title ??
            order.rfq?.product?.title ??
            'Order Item',
          category1:
            order.product?.category?.parent?.name ??
            order.product?.category?.name ??
            'B2B',
          category2:
            order.product?.category?.parent
              ? order.product.category.name
              : undefined,
          itemType: 'PHYSICAL',
          price: order.totalAmount.toString(),
          subMerchantKey: order.seller.iyzicoSubMerchantKey,
          subMerchantPrice: order.payoutAmount.toString(),
        },
      ],
    };

    const result = await this.iyzico.createCheckoutFormInitialize(request);

    if (!result || result.status !== 'success') {
      throw new BadRequestException('IyziCo ödeme başlatılamadı');
    }

    const checkoutToken = String(result.token ?? '').trim();

    if (!checkoutToken) {
      throw new BadRequestException(
        'IyziCo ödeme başlatma yanıtında geçerli token alınamadı',
      );
    }

    const sanitizedRequest = {
      locale: request.locale,
      conversationId: request.conversationId,
      price: request.price,
      paidPrice: request.paidPrice,
      currency: request.currency,
      basketId: request.basketId,
      paymentGroup: request.paymentGroup,
      buyerId: request.buyer?.id ?? null,
      basketItems: (request.basketItems || []).map((item: any) => ({
        id: item.id,
        name: item.name,
        category1: item.category1,
        category2: item.category2,
        itemType: item.itemType,
        price: item.price,
        subMerchantPrice: item.subMerchantPrice,
      })),
    };

    // ✅ PaymentAttempt kaydı aç (token/order bağını burada tutuyoruz)
    await this.prisma.paymentAttempt.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.IYZICO,
        status: PaymentStatus.INITIATED,
        conversationId,
        checkoutToken,
        rawRequest: sanitizedRequest,
        rawResponse: this.safeIyzicoResult(result),
      },
    });

    // (Opsiyonel) Order üzerinde de debug alanı tutmak istersen:
    // await this.prisma.order.update({ where:{id:order.id}, data:{ iyzicoConversationId: conversationId } });

    return {
      message: 'iyzico init ok',
      orderId: order.id,
      conversationId,
      token: checkoutToken,
      checkoutFormContent: result.checkoutFormContent,
      paymentPageUrl: result.paymentPageUrl,
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
      result: this.safeIyzicoResult(result),
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

    const normalizedToken = token.trim();

    const attempts = await this.prisma.paymentAttempt.findMany({
      where: {
        checkoutToken: normalizedToken,
        provider: PaymentProvider.IYZICO,
      },
      take: 2,
    });

    if (attempts.length !== 1) {
      throw new BadRequestException(
        attempts.length === 0
          ? 'Bu ödeme tokenı için geçerli bir ödeme denemesi bulunamadı'
          : 'Bu ödeme tokenı birden fazla ödeme denemesiyle eşleşiyor',
      );
    }

    const attempt = attempts[0];
    const expectedConversationId = String(attempt.conversationId ?? '').trim();

    if (!expectedConversationId) {
      throw new BadRequestException(
        'Ödeme denemesinin conversationId kaydı bulunamadı',
      );
    }

    const result: any = await this.iyzico.retrieveCheckoutForm(
      normalizedToken,
      expectedConversationId,
    );

    if (!result || result.status !== 'success') {
      throw new BadRequestException('IyziCo ödeme doğrulanamadı');
    }

    const basketOrderId = String(result.basketId ?? '').trim();
    const resultConversationId = String(result.conversationId ?? '').trim();

    if (!basketOrderId || basketOrderId !== attempt.orderId) {
      throw new BadRequestException(
        'iyzico basketId ile ödeme denemesi siparişi eşleşmiyor',
      );
    }

    if (
      !resultConversationId ||
      !expectedConversationId ||
      resultConversationId !== expectedConversationId
    ) {
      throw new BadRequestException(
        'iyzico conversationId ile ödeme denemesi eşleşmiyor',
      );
    }

    const expectedBasketItemId = this.getExpectedBasketItemId(
      attempt.rawRequest,
    );

    if (!expectedBasketItemId) {
      throw new BadRequestException(
        'Ödeme denemesinin basket item kaydı doğrulanamadı',
      );
    }

    await this.prisma.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        callbackVerifiedAt: null,
      },
      data: {
        callbackVerifiedAt: new Date(),
      },
    });

    return this.processSuccessfulPayment(
      attempt.id,
      attempt.orderId,
      normalizedToken,
      result,
      expectedBasketItemId,
      resultConversationId,
    );
  }

  async reconcileIyzicoPayment(user: any, paymentAttemptId: string) {
    if (user?.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN ödeme mutabakatı yapabilir');
    }

    const attempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        id: paymentAttemptId,
        provider: PaymentProvider.IYZICO,
      },
    });

    if (!attempt) {
      throw new NotFoundException('Ödeme denemesi bulunamadı');
    }

    const token = String(attempt.checkoutToken ?? '').trim();
    const expectedConversationId = String(
      attempt.conversationId ?? '',
    ).trim();

    if (!token || !expectedConversationId) {
      throw new BadRequestException(
        'Ödeme denemesinin iyzico doğrulama bilgileri eksik',
      );
    }

    const expectedBasketItemId = this.getExpectedBasketItemId(
      attempt.rawRequest,
    );

    if (!expectedBasketItemId) {
      throw new BadRequestException(
        'Ödeme denemesinin basket item kaydı doğrulanamadı',
      );
    }

    const result: any = await this.iyzico.retrieveCheckoutForm(
      token,
      expectedConversationId,
    );

    if (!result || result.status !== 'success') {
      const safeResult = this.safeIyzicoResult(result);

      return {
        reconciled: false,
        message: 'iyzico ödeme sonucu doğrulanamadı',
        result: safeResult,
      };
    }

    const basketOrderId = String(result.basketId ?? '').trim();
    const resultConversationId = String(result.conversationId ?? '').trim();

    if (!basketOrderId || basketOrderId !== attempt.orderId) {
      throw new BadRequestException(
        'iyzico basketId ile ödeme denemesi siparişi eşleşmiyor',
      );
    }

    if (
      !resultConversationId ||
      resultConversationId !== expectedConversationId
    ) {
      throw new BadRequestException(
        'iyzico conversationId ile ödeme denemesi eşleşmiyor',
      );
    }

    await this.prisma.paymentAttempt.updateMany({
      where: {
        id: attempt.id,
        callbackVerifiedAt: null,
      },
      data: {
        callbackVerifiedAt: new Date(),
      },
    });

    return this.processSuccessfulPayment(
      attempt.id,
      attempt.orderId,
      token,
      result,
      expectedBasketItemId,
      resultConversationId,
    );
  }

  /**
   * Ödeme başarılıysa tek noktadan işle
   * - idempotent: order zaten PAID ise tekrar yapma
   */
  private async processSuccessfulPayment(
    paymentAttemptId: string,
    orderId: string,
    token: string,
    result: any,
    expectedBasketItemId: string,
    resultConversationId: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const paymentStatus = String(result.paymentStatus ?? '').toUpperCase();
    const iyzicoPaymentId = String(result.paymentId ?? '').trim();

    const currentAttempt = await this.prisma.paymentAttempt.findFirst({
      where: {
        id: paymentAttemptId,
        orderId,
        provider: PaymentProvider.IYZICO,
      },
    });

    if (!currentAttempt) {
      throw new BadRequestException('Ödeme denemesi doğrulanamadı');
    }

    if (currentAttempt.status === PaymentStatus.SUCCESS) {
      const storedPaymentId = String(currentAttempt.iyzicoPaymentId ?? '').trim();

      if (
        !storedPaymentId ||
        !iyzicoPaymentId ||
        storedPaymentId !== iyzicoPaymentId
      ) {
        throw new BadRequestException(
          'Başarılı ödeme denemesinin iyzico kimliği eşleşmiyor',
        );
      }
    }

    if (
      currentAttempt.status === PaymentStatus.SUCCESS &&
      paymentStatus !== 'SUCCESS'
    ) {
      throw new BadRequestException(
        'Başarılı ödeme için iyzico durumu değişti; mutabakat gerekli',
      );
    }

    if (paymentStatus !== 'SUCCESS') {
      await this.markPaymentAttemptFailed(
        paymentAttemptId,
        result,
      );

      throw new BadRequestException('IyziCo ödeme onayı başarısız');
    }

    if (!iyzicoPaymentId) {
      await this.markPaymentAttemptFailed(
        paymentAttemptId,
        result,
      );

      throw new BadRequestException(
        'iyzico ödeme kimliği doğrulanamadı',
      );
    }

    const receivedAmount = new Prisma.Decimal(
      result.price ?? 0,
    );

    const expectedAmount = new Prisma.Decimal(order.totalAmount);

    if (
      currentAttempt.status === PaymentStatus.SUCCESS &&
      !receivedAmount.equals(expectedAmount)
    ) {
      throw new BadRequestException(
        'Başarılı ödemenin tutarı değişti; mutabakat gerekli',
      );
    }

    if (!receivedAmount.equals(expectedAmount)) {
      await this.markPaymentAttemptFailed(
        paymentAttemptId,
        result,
      );

      throw new BadRequestException(
        'Ödeme tutarı sipariş tutarıyla eşleşmiyor',
      );
    }

    const fraudStatus = Number(result.fraudStatus);

    if (
      currentAttempt.status === PaymentStatus.SUCCESS &&
      fraudStatus !== 1
    ) {
      throw new BadRequestException(
        'Başarılı ödemenin risk durumu değişti; mutabakat gerekli',
      );
    }

    if (fraudStatus === 0) {
      await this.markPaymentAttemptReview(
        paymentAttemptId,
        result,
        iyzicoPaymentId,
      );

      return {
        message: 'Ödeme iyzico risk incelemesinde',
        orderId: order.id,
        status: order.status,
        paymentStatus: PaymentStatus.REVIEW,
      };
    }

    if (fraudStatus !== 1) {
      await this.markPaymentAttemptFailed(
        paymentAttemptId,
        result,
        iyzicoPaymentId,
      );

      throw new BadRequestException(
        'IyziCo risk kontrolü ödeme işlemini onaylamadı',
      );
    }

    const itemTransactions = Array.isArray(result.itemTransactions)
      ? result.itemTransactions
      : [];

    if (itemTransactions.length !== 1) {
      throw new BadRequestException(
        'iyzico işlem satırı sayısı doğrulanamadı',
      );
    }

    const itemTransaction = itemTransactions[0];
    const receivedItemId = String(itemTransaction?.itemId ?? '').trim();
    const paymentTransactionId = String(
      itemTransaction?.paymentTransactionId ?? '',
    ).trim();

    if (
      receivedItemId !== expectedBasketItemId ||
      !paymentTransactionId
    ) {
      throw new BadRequestException(
        'iyzico işlem satırı siparişle doğrulanamadı',
      );
    }

    const postPaymentStatuses: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.PREPARING,
      OrderStatus.SHIPPED,
      OrderStatus.COMPLETED,
    ];

    if (
      currentAttempt.status === PaymentStatus.SUCCESS &&
      !postPaymentStatuses.includes(order.status)
    ) {
      throw new BadRequestException(
        'Başarılı ödeme ile sipariş durumu tutarsız; mutabakat gerekli',
      );
    }

    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException(
        'İptal edilmiş sipariş için ödeme işlenemez',
      );
    }

    if (
      order.status !== OrderStatus.PENDING_PAYMENT &&
      !postPaymentStatuses.includes(order.status)
    ) {
      throw new BadRequestException(
        'Sipariş durumu ödeme işlemi için geçerli değil',
      );
    }

    const escrowAmount = new Prisma.Decimal(order.escrowAmount);

    if (escrowAmount.lte(0)) {
      throw new BadRequestException('Escrow amount 0 olamaz');
    }

    const processed = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.PENDING_PAYMENT,
        },
        data: {
          status: OrderStatus.PAID,
          iyzicoConversationId: resultConversationId,
          iyzicoCheckoutToken: token,
          iyzicoPaymentId,
          iyzicoPaidAt: new Date(),
          iyzicoRawResult: this.safeIyzicoResult(result),
        },
      });

      if (claimed.count === 0) {
        const currentOrder = await tx.order.findUnique({
          where: { id: order.id },
        });

        if (!currentOrder) {
          throw new BadRequestException('Sipariş bulunamadı');
        }

        if (
          currentOrder.status === OrderStatus.CANCELLED ||
          !postPaymentStatuses.includes(currentOrder.status)
        ) {
          throw new BadRequestException(
            'Sipariş ödeme sırasında başka bir duruma geçti',
          );
        }

        const existingPaymentTransaction =
          await tx.paymentTransaction.findUnique({
            where: {
              paymentTransactionId,
            },
          });

        const samePayment =
          currentOrder.iyzicoPaymentId === iyzicoPaymentId &&
          currentOrder.iyzicoCheckoutToken === token &&
          currentOrder.iyzicoConversationId ===
            resultConversationId &&
          existingPaymentTransaction?.orderId === currentOrder.id &&
          existingPaymentTransaction?.sellerId === currentOrder.sellerId &&
          existingPaymentTransaction !== null &&
          new Prisma.Decimal(existingPaymentTransaction.amount).equals(
            expectedAmount,
          );

        if (!samePayment) {
          throw new BadRequestException(
            'Eşzamanlı ödeme işlemi mevcut siparişle doğrulanamadı',
          );
        }

        await this.markPaymentAttemptSuccess(
          tx,
          paymentAttemptId,
          result,
          iyzicoPaymentId,
        );

        return {
          message: 'Order zaten aynı iyzico ödemesiyle işlenmiş',
          orderId: currentOrder.id,
          status: currentOrder.status,
          newlyPaid: false,
        };
      }

      const existingPaymentTransaction =
        await tx.paymentTransaction.findUnique({
          where: {
            paymentTransactionId,
          },
        });

      if (existingPaymentTransaction) {
        throw new BadRequestException(
          'iyzico işlem kimliği daha önce kaydedilmiş; mutabakat gerekli',
        );
      }

      await this.ensureWallet(tx, order.buyerId);
      await this.ensureWallet(tx, order.sellerId);

      await tx.paymentTransaction.create({
        data: {
          orderId: order.id,
          sellerId: order.sellerId,
          paymentTransactionId,
          amount: expectedAmount,
          status: 'SUCCESS',
        },
      });

      await tx.companyWallet.update({
        where: {
          companyId: order.buyerId,
        },
        data: {
          locked: {
            increment: escrowAmount,
          },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          type: LedgerType.ESCROW_DEPOSIT,
          amount: escrowAmount,
          currency: 'TRY',
          note: 'IyziCo payment deposited into escrow',
          meta: {
            token,
            paymentId: iyzicoPaymentId,
            paymentTransactionId,
          },
        },
      });

      await tx.ledgerEntry.create({
        data: {
          orderId: order.id,
          type: LedgerType.COMMISSION,
          amount: order.commissionAmount,
          currency: 'TRY',
          note: 'Platform commission reserved',
          meta: {
            token,
            paymentId: iyzicoPaymentId,
            paymentTransactionId,
          },
        },
      });

      await this.markPaymentAttemptSuccess(
        tx,
        paymentAttemptId,
        result,
        iyzicoPaymentId,
      );

      const updatedOrder = await tx.order.findUnique({
        where: {
          id: order.id,
        },
      });

      return {
        message: 'Payment verified and order marked as PAID',
        order: updatedOrder,
        newlyPaid: true,
      };
    });

    if (processed.newlyPaid) {
      const sellerUsers = await this.prisma.user.findMany({
        where: {
          companyId: order.sellerId,
        },
        select: {
          id: true,
        },
      });

      for (const seller of sellerUsers) {
        await this.notificationService.createNotification({
          userId: seller.id,
          type: 'PAYMENT',
          title: 'Ödeme Alındı',
          message:
            'Alıcı ödemeyi tamamladı. Siparişi hazırlamaya başlayabilirsiniz.',
          link: '/seller/orders',
        });
      }

      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: Role.ADMIN,
        },
        select: {
          id: true,
        },
      });

      const paymentAmount = new Prisma.Decimal(order.totalAmount).toFixed(2);

      for (const admin of adminUsers) {
        await this.notificationService.createNotification({
          userId: admin.id,
          type: 'PAYMENT',
          title: 'Yeni Ödeme Alındı',
          message: `${paymentAmount} ₺ tutarındaki sipariş ödemesi başarıyla alındı.`,
          link: '/admin/orders',
        });
      }
    }

    const { newlyPaid, ...response } = processed;
    return response;
  }
}
