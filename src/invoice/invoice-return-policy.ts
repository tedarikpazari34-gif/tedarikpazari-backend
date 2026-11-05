import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  InvoiceRecordKind,
  InvoiceRecordStatus,
  DisputeStatus,
  DisputeResolution,
  OrderStatus,
  Prisma,
  Role,
} from '@prisma/client';

type Money = Prisma.Decimal | string | number;

export interface ReturnPolicyInput {
  actor: {
    role: Role;
    companyId: string;
  };

  kind: InvoiceRecordKind;

  dispute: {
    id: string;
    orderId: string;
    buyerId: string;
    sellerId: string;
    status: DisputeStatus;
    resolution?: DisputeResolution | null;
    resolvedAt: Date | null;
  };

  order: {
    id: string;
    buyerId: string;
    sellerId: string;
    status: OrderStatus;
    totalAmount: Money;
  };

  payment: {
    orderId: string;
    sellerId: string;
    amount: Money;
    status: string;
    iyzicoRefundPendingAt: Date | null;
    iyzicoRefundedAt: Date | null;
    iyzicoRefundedAmount: Money;
  };

  saleInvoice: {
    id: string;
    orderId: string;
    buyerId: string;
    sellerId: string;
    issuerCompanyId: string;
    kind: InvoiceRecordKind;
    status: InvoiceRecordStatus;
    currency: string;
    totalAmount: Money;
  };
}

function decimal(value: Money): Prisma.Decimal {
  try {
    const result = new Prisma.Decimal(value);

    if (!result.isFinite() || result.isNeg()) {
      throw new Error('invalid monetary value');
    }

    return result;
  } catch {
    throw new BadRequestException(
      'Geçersiz fatura veya ödeme tutarı',
    );
  }
}

/**
 * Yalnız platformun veritabanındaki kayıtları doğrular.
 * Bu fonksiyon resmi belge düzenlemez, PDF doğrulamaz,
 * iyzico çağrısı yapmaz ve veritabanını değiştirmez.
 */
export function assertReturnDocumentEligible(
  input: ReturnPolicyInput,
) {
  const {
    actor,
    kind,
    dispute,
    order,
    payment,
    saleInvoice,
  } = input;

  if (
    !actor ||
    typeof actor.companyId !== 'string' ||
    !actor.companyId
  ) {
    throw new ForbiddenException(
      'Geçerli şirket yetkisi gerekli',
    );
  }

  // Bu platform politikasında RETURN belgesini
  // alıcı, CREDIT_NOTE belgesini satıcı kaydeder.
  // Hukuki belge türü ayrıca doğrulanmalıdır.
  const isBuyerReturn =
    kind === InvoiceRecordKind.RETURN &&
    actor.role === Role.BUYER &&
    actor.companyId === order.buyerId;

  const isSellerCredit =
    kind === InvoiceRecordKind.CREDIT_NOTE &&
    actor.role === Role.SELLER &&
    actor.companyId === order.sellerId;

  if (!isBuyerReturn && !isSellerCredit) {
    throw new ForbiddenException(
      'Bu iade belgesini kaydetme yetkiniz yok',
    );
  }

  if (
    !dispute ||
    !dispute.id ||
    dispute.orderId !== order.id ||
    dispute.buyerId !== order.buyerId ||
    dispute.sellerId !== order.sellerId
  ) {
    throw new BadRequestException(
      'Uyuşmazlık ve sipariş eşleşmesi doğrulanamadı',
    );
  }

  if (
    order.status === OrderStatus.PENDING_PAYMENT ||
    !order.id ||
    !order.buyerId ||
    !order.sellerId
  ) {
    throw new BadRequestException(
      'Sipariş iade belgesine uygun değil',
    );
  }

  if (
    payment.orderId !== order.id ||
    payment.sellerId !== order.sellerId ||
    payment.status !== 'SUCCESS' ||
    payment.iyzicoRefundPendingAt
  ) {
    throw new BadRequestException(
      'İyzico ödeme veya iade durumu doğrulanamadı',
    );
  }

  const orderAmount = decimal(order.totalAmount);
  const paymentAmount = decimal(payment.amount);
  const refundedAmount = decimal(
    payment.iyzicoRefundedAmount,
  );

  if (
    !orderAmount.gt(0) ||
    !paymentAmount.equals(orderAmount)
  ) {
    throw new BadRequestException(
      'Ödeme tutarı sipariş tutarıyla uyuşmuyor',
    );
  }

  const beforeRefund =
    (
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.PREPARING ||
      order.status === OrderStatus.SHIPPED
    ) &&
    payment.iyzicoRefundedAt === null &&
    refundedAmount.isZero();

  const afterFullRefund =
    order.status === OrderStatus.CANCELLED &&
    payment.iyzicoRefundedAt !== null &&
    refundedAmount.equals(paymentAmount);

  if (!beforeRefund && !afterFullRefund) {
    throw new BadRequestException(
      'İade belgesi için geçerli ödeme aşaması doğrulanamadı',
    );
  }

  const activeDispute =
    (
      dispute.status === DisputeStatus.OPEN ||
      dispute.status === DisputeStatus.SELLER_RESPONDED
    ) &&
    dispute.resolvedAt === null &&
    dispute.resolution == null;

  const completedBuyerRefundDispute =
    dispute.status === DisputeStatus.RESOLVED_BUYER &&
    dispute.resolution === DisputeResolution.REFUND_TO_BUYER &&
    dispute.resolvedAt instanceof Date &&
    !Number.isNaN(dispute.resolvedAt.getTime()) &&
    afterFullRefund;

  if (!activeDispute && !completedBuyerRefundDispute) {
    throw new BadRequestException(
      'İade belgesi için geçerli uyuşmazlık kararı doğrulanamadı',
    );
  }

  if (
    !saleInvoice.id ||
    saleInvoice.orderId !== order.id ||
    saleInvoice.buyerId !== order.buyerId ||
    saleInvoice.sellerId !== order.sellerId ||
    saleInvoice.issuerCompanyId !== order.sellerId ||
    saleInvoice.kind !== InvoiceRecordKind.SALE ||
    saleInvoice.status !== InvoiceRecordStatus.RECORDED ||
    saleInvoice.currency !== 'TRY' ||
    !decimal(saleInvoice.totalAmount).equals(orderAmount)
  ) {
    throw new BadRequestException(
      'Orijinal satış faturası doğrulanamadı',
    );
  }

  return {
    orderId: order.id,
    originalSaleInvoiceId: saleInvoice.id,
    issuerCompanyId: actor.companyId,
    kind,
    amount: orderAmount.toFixed(2),
  };
}
