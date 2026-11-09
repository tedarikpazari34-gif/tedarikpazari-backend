import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ServiceUnavailableException } from '@nestjs/common';
import { InvoiceWriteGuard } from './invoice-write.guard';
import { InvoiceController } from './invoice.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

describe('InvoiceWriteGuard production safety', () => {
  const original = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_INVOICE_WRITE: process.env.ENABLE_INVOICE_WRITE,
    ALLOW_LIVE_INVOICE_WRITE: process.env.ALLOW_LIVE_INVOICE_WRITE,
  };

  const guard = new InvoiceWriteGuard();

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_INVOICE_WRITE;
    delete process.env.ALLOW_LIVE_INVOICE_WRITE;
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('defaults to closed', () => {
    expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);
  });

  it('rejects production with only the first flag', () => {
    process.env.ENABLE_INVOICE_WRITE = 'true';
    expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);
  });

  it('rejects production with only the second flag', () => {
    process.env.ALLOW_LIVE_INVOICE_WRITE = 'true';
    expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);
  });

  it('allows production only with both explicit flags', () => {
    process.env.ENABLE_INVOICE_WRITE = 'true';
    process.env.ALLOW_LIVE_INVOICE_WRITE = 'true';
    expect(guard.canActivate()).toBe(true);
  });

  it('rejects non-exact flag values', () => {
    process.env.ENABLE_INVOICE_WRITE = 'TRUE';
    process.env.ALLOW_LIVE_INVOICE_WRITE = 'true';
    expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);
  });

  it('allows explicitly enabled isolated test environment', () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_INVOICE_WRITE = 'true';
    expect(guard.canActivate()).toBe(true);
  });

  it('rejects development when the first flag is missing', () => {
    process.env.NODE_ENV = 'development';
    expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);
  });

  it('protects all three write endpoints', () => {
    for (const method of ['uploadSale', 'uploadReturn', 'review']) {
      const handler = (InvoiceController.prototype as any)[method];
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) || [];
      expect(guards).toContain(InvoiceWriteGuard);
    }
  });

  it('preserves JWT authentication on the controller', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, InvoiceController) || [];
    expect(guards).toContain(JwtAuthGuard);
  });

  it('preserves admin authorization on review', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA, InvoiceController.prototype.review
    ) || [];
    expect(guards).toContain(AdminGuard);
  });

  it('does not lock read-only endpoints', () => {
    for (const method of ['mine', 'admin', 'download', 'access']) {
      const handler = (InvoiceController.prototype as any)[method];
      const guards = Reflect.getMetadata(GUARDS_METADATA, handler) || [];
      expect(guards).not.toContain(InvoiceWriteGuard);
    }
  });
});
