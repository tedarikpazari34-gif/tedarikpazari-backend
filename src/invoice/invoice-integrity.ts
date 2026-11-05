import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type Money = Prisma.Decimal | string | number;

type Amounts = {
  netAmount: Money;
  vatAmount: Money;
  totalAmount: Money;
};

type InvoiceAmounts = Amounts & {
  kind: string;
  currency: string;
};

// PDF içeriğini değil, platformun kayıtlı parasal alanlarını
// doğrular. Gerçek PDF içerik kontrolü ayrıca gereklidir.
export function assertInvoiceSnapshot(
  invoice: InvoiceAmounts,
  order: Amounts,
): void {
  if (invoice.kind !== 'SALE' || invoice.currency !== 'TRY') {
    throw new BadRequestException(
      'Fatura türü veya para birimi doğrulanamadı',
    );
  }

  for (const field of [
    'netAmount',
    'vatAmount',
    'totalAmount',
  ] as const) {
    try {
      const actual = new Prisma.Decimal(invoice[field]);
      const expected = new Prisma.Decimal(order[field]);

      if (
        !actual.isFinite() ||
        !expected.isFinite() ||
        actual.isNeg() ||
        expected.isNeg() ||
        !actual.equals(expected)
      ) {
        throw new Error('amount mismatch');
      }
    } catch {
      throw new BadRequestException(
        `Fatura kayıt tutarı siparişle uyuşmuyor: ${field}`,
      );
    }
  }
}
