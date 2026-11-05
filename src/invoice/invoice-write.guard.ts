import {
  CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

@Injectable()
export class InvoiceWriteGuard implements CanActivate {
  canActivate(): boolean {
    if (process.env.ENABLE_INVOICE_WRITE !== 'true') {
      throw new ServiceUnavailableException(
        'Fatura yükleme ve onay işlemleri henüz etkin değil',
      );
    }

    const localEnvironment =
      process.env.NODE_ENV === 'test' ||
      process.env.NODE_ENV === 'development';

    if (
      !localEnvironment &&
      process.env.ALLOW_LIVE_INVOICE_WRITE !== 'true'
    ) {
      throw new ServiceUnavailableException(
        'Fatura yazma işlemleri bu ortamda kapalı',
      );
    }

    return true;
  }
}
