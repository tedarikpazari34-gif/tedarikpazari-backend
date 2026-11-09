import {
  DisputeStatus,
  DisputeResolution,
  InvoiceRecordKind,
  InvoiceRecordStatus,
  OrderStatus,
  Role,
} from '@prisma/client';
import {
  assertReturnDocumentEligible,
  ReturnPolicyInput,
} from './invoice-return-policy';

describe('Return invoice authorization and refund safety', () => {
  const valid: ReturnPolicyInput = {
    actor: {
      role: Role.BUYER,
      companyId: 'buyer1',
    },
    kind: InvoiceRecordKind.RETURN,
    dispute: {
      id: 'dispute1',
      orderId: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: DisputeStatus.OPEN,
      resolvedAt: null,
    },
    order: {
      id: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      status: OrderStatus.CANCELLED,
      totalAmount: '120.00',
    },
    payment: {
      orderId: 'order1',
      sellerId: 'seller1',
      amount: '120.00',
      status: 'SUCCESS',
      iyzicoRefundPendingAt: null,
      iyzicoRefundedAt: new Date(),
      iyzicoRefundedAmount: '120.00',
    },
    saleInvoice: {
      id: 'sale1',
      orderId: 'order1',
      buyerId: 'buyer1',
      sellerId: 'seller1',
      issuerCompanyId: 'seller1',
      kind: InvoiceRecordKind.SALE,
      status: InvoiceRecordStatus.RECORDED,
      currency: 'TRY',
      totalAmount: '120.00',
    },
  };

  // 2080: closed dispute refund security
  const closedBuyerRefund = (): ReturnPolicyInput => ({
    ...valid,
    dispute: {
      ...valid.dispute,
      status: DisputeStatus.RESOLVED_BUYER,
      resolution: DisputeResolution.REFUND_TO_BUYER,
      resolvedAt: new Date(),
    },
  });

  it('allows documentation after confirmed full refund and buyer resolution', () => {
    expect(
      assertReturnDocumentEligible(closedBuyerRefund())
    ).toEqual(expect.objectContaining({
      orderId: 'order1',
      originalSaleInvoiceId: 'sale1',
    }));
  });

  it('rejects seller-favorable closed dispute', () => {
    const input = closedBuyerRefund();
    input.dispute.status = DisputeStatus.RESOLVED_SELLER;
    input.dispute.resolution = DisputeResolution.RELEASE_TO_SELLER;

    expect(() => assertReturnDocumentEligible(input)).toThrow();
  });

  it('rejects buyer status without confirmed refund resolution', () => {
    const input = closedBuyerRefund();
    input.dispute.resolution = DisputeResolution.RELEASE_TO_SELLER;

    expect(() => assertReturnDocumentEligible(input)).toThrow();
  });

  it('rejects closed dispute without completed full refund', () => {
    const input = closedBuyerRefund();
    input.payment = {
      ...input.payment,
      iyzicoRefundedAt: null,
      iyzicoRefundedAmount: '0',
    };

    expect(() => assertReturnDocumentEligible(input)).toThrow();
  });

  it.each([
    DisputeStatus.OPEN,
    DisputeStatus.SELLER_RESPONDED,
  ])('rejects completed refund with unresolved dispute %s', (status) => {
    const input = {
      ...valid,
      dispute: { ...valid.dispute, status },
    };

    expect(() => assertReturnDocumentEligible(input)).toThrow();

    expect(() => assertReturnDocumentEligible({
      ...input,
      actor: { role: Role.SELLER, companyId: 'seller1' },
      kind: InvoiceRecordKind.CREDIT_NOTE,
    })).toThrow();
  });

  it('allows buyer return documentation after full refund', () => {
    const result = assertReturnDocumentEligible(closedBuyerRefund());

    expect(result).toEqual({
      orderId: 'order1',
      originalSaleInvoiceId: 'sale1',
      issuerCompanyId: 'buyer1',
      kind: InvoiceRecordKind.RETURN,
      amount: '120.00',
    });
  });

  it('allows seller credit documentation for seller company', () => {
    const result = assertReturnDocumentEligible({
      ...closedBuyerRefund(),
      actor: {
        role: Role.SELLER,
        companyId: 'seller1',
      },
      kind: InvoiceRecordKind.CREDIT_NOTE,
    });

    expect(result.issuerCompanyId).toBe('seller1');
  });

  it('allows return documentation before iyzico refund starts', () => {
    const result = assertReturnDocumentEligible({
      ...valid,
      order: {
        ...valid.order,
        status: OrderStatus.PAID,
      },
      payment: {
        ...valid.payment,
        iyzicoRefundPendingAt: null,
        iyzicoRefundedAt: null,
        iyzicoRefundedAmount: '0',
      },
    });

    expect(result.orderId).toBe('order1');
    expect(result.amount).toBe('120.00');
  });

  it.each([
    OrderStatus.PAID,
    OrderStatus.PREPARING,
    OrderStatus.SHIPPED,
  ])('allows pre-refund documentation for %s', (status) => {
    const result = assertReturnDocumentEligible({
      ...valid,
      order: { ...valid.order, status },
      payment: {
        ...valid.payment,
        iyzicoRefundPendingAt: null,
        iyzicoRefundedAt: null,
        iyzicoRefundedAmount: '0',
      },
    });

    expect(result.orderId).toBe('order1');
    expect(result.amount).toBe('120.00');
  });

  it('rejects return documentation while iyzico refund is pending', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      order: {
        ...valid.order,
        status: OrderStatus.PAID,
      },
      payment: {
        ...valid.payment,
        iyzicoRefundPendingAt: new Date(),
        iyzicoRefundedAt: null,
        iyzicoRefundedAmount: '0',
      },
    })).toThrow();
  });

  it('rejects another buyer company', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      actor: {
        role: Role.BUYER,
        companyId: 'other-buyer',
      },
    })).toThrow();
  });

  it('rejects a seller pretending to issue buyer return', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      actor: {
        role: Role.SELLER,
        companyId: 'seller1',
      },
    })).toThrow();
  });

  it('rejects a pending refund', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      payment: {
        ...valid.payment,
        iyzicoRefundPendingAt: new Date(),
      },
    })).toThrow();
  });

  it('rejects an unfinished refund', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      payment: {
        ...valid.payment,
        iyzicoRefundedAt: null,
      },
    })).toThrow();
  });

  it('rejects partial refunds', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      payment: {
        ...valid.payment,
        iyzicoRefundedAmount: '60.00',
      },
    })).toThrow();
  });

  it('rejects payment amount mismatch', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      payment: {
        ...valid.payment,
        amount: '110.00',
      },
    })).toThrow();
  });

  it('rejects another order original invoice', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      saleInvoice: {
        ...valid.saleInvoice,
        orderId: 'other-order',
      },
    })).toThrow();
  });

  it('rejects a rejected original invoice', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      saleInvoice: {
        ...valid.saleInvoice,
        status: InvoiceRecordStatus.REJECTED,
      },
    })).toThrow();
  });

  it('rejects return-as-original document', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      saleInvoice: {
        ...valid.saleInvoice,
        kind: InvoiceRecordKind.RETURN,
      },
    })).toThrow();
  });

  it('rejects pending-payment orders', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      order: {
        ...valid.order,
        status: OrderStatus.PENDING_PAYMENT,
      },
    })).toThrow();
  });

  it('rejects mismatched original sale amounts', () => {
    expect(() => assertReturnDocumentEligible({
      ...valid,
      saleInvoice: {
        ...valid.saleInvoice,
        totalAmount: '119.99',
      },
    })).toThrow();
  });
});
