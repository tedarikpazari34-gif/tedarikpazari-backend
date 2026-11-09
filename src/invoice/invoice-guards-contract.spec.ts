
import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InvoiceWriteGuard } from './invoice-write.guard';
import { AdminGuard } from '../common/guards/admin.guard';

describe('Gerçek fatura güvenlik korumaları', () => {
  const keys = [
    'NODE_ENV',
    'ENABLE_INVOICE_WRITE',
    'ALLOW_LIVE_INVOICE_WRITE',
  ] as const;

  const original = keys.map(key => process.env[key]);

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_INVOICE_WRITE;
    delete process.env.ALLOW_LIVE_INVOICE_WRITE;
  });

  afterEach(() => {
    keys.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  });

  const write = () => new InvoiceWriteGuard().canActivate();

  it('yazma izni yoksa reddeder', () => {
    expect(write).toThrow;
    expect(() => write()).toThrow(ServiceUnavailableException);
  });

  it('test ortamında da ana etkinleştirme zorunludur', () => {
    process.env.NODE_ENV = 'test';
    expect(() => write()).toThrow(ServiceUnavailableException);
  });

  it('canlı ortamda ikinci izin olmadan reddeder', () => {
    process.env.ENABLE_INVOICE_WRITE = 'true';
    expect(() => write()).toThrow(ServiceUnavailableException);
  });

  it('canlı ortamda ikinci izin false ise reddeder', () => {
    process.env.ENABLE_INVOICE_WRITE = 'true';
    process.env.ALLOW_LIVE_INVOICE_WRITE = 'false';
    expect(() => write()).toThrow(ServiceUnavailableException);
  });

  it('canlı ortamda iki açık izinle çalışır', () => {
    process.env.ENABLE_INVOICE_WRITE = 'true';
    process.env.ALLOW_LIVE_INVOICE_WRITE = 'true';
    expect(write()).toBe(true);
  });

  it.each(['test', 'development'])(
    '%s ortamında ana izin yeterlidir',
    env => {
      process.env.NODE_ENV = env;
      process.env.ENABLE_INVOICE_WRITE = 'true';
      expect(write()).toBe(true);
    },
  );

  const context = (role?: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        user: role ? { role } : undefined,
      }),
    }),
  } as unknown as ExecutionContext);

  it.each([undefined, 'BUYER', 'SELLER', 'LOGISTICS'])(
    'ADMIN olmayan %s rolünü reddeder',
    role => {
      expect(() =>
        new AdminGuard().canActivate(context(role)),
      ).toThrow(ForbiddenException);
    },
  );

  it('ADMIN rolüne izin verir', () => {
    expect(
      new AdminGuard().canActivate(context('ADMIN')),
    ).toBe(true);
  });
});
