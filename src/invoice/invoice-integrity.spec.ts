import { assertInvoiceSnapshot } from './invoice-integrity';

describe('Invoice amount and refund consistency', () => {
  const invoice = {
    kind: 'SALE',
    currency: 'TRY',
    netAmount: '100.10',
    vatAmount: '20.02',
    totalAmount: '120.12',
  };

  const order = {
    netAmount: '100.10',
    vatAmount: '20.02',
    totalAmount: '120.12',
  };

  it('accepts matching decimal amounts', () => {
    expect(() => assertInvoiceSnapshot(invoice, order)).not.toThrow();
  });

  it('rejects a different net amount', () => {
    expect(() => assertInvoiceSnapshot(
      { ...invoice, netAmount: '100.11' },
      order,
    )).toThrow('netAmount');
  });

  it('rejects a different VAT amount', () => {
    expect(() => assertInvoiceSnapshot(
      { ...invoice, vatAmount: '20.03' },
      order,
    )).toThrow('vatAmount');
  });

  it('rejects a different total amount', () => {
    expect(() => assertInvoiceSnapshot(
      { ...invoice, totalAmount: '120.13' },
      order,
    )).toThrow('totalAmount');
  });

  it('rejects an unsupported currency', () => {
    expect(() => assertInvoiceSnapshot(
      { ...invoice, currency: 'USD' },
      order,
    )).toThrow();
  });

  it('does not treat a return invoice as a sale invoice', () => {
    expect(() => assertInvoiceSnapshot(
      { ...invoice, kind: 'RETURN' },
      order,
    )).toThrow();
  });

  it('rejects negative and invalid amounts', () => {
    expect(() => assertInvoiceSnapshot(
      { ...invoice, totalAmount: '-1' },
      order,
    )).toThrow();

    expect(() => assertInvoiceSnapshot(
      { ...invoice, totalAmount: 'invalid' },
      order,
    )).toThrow();
  });
});
