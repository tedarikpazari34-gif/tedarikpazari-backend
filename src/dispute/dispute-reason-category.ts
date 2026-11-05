export const DISPUTE_REASON_CATEGORIES = [
  'PRODUCT_RETURN',
  'NOT_SHIPPED',
  'DAMAGED_OR_WRONG_PRODUCT',
  'PAYMENT_ISSUE',
  'OTHER',
] as const;

export type DisputeReasonCategory =
  (typeof DISPUTE_REASON_CATEGORIES)[number];

export function isDisputeReasonCategory(
  value: unknown,
): value is DisputeReasonCategory {
  return (
    typeof value === 'string' &&
    DISPUTE_REASON_CATEGORIES.some((category) => category === value)
  );
}
