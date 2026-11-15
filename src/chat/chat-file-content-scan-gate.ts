import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Security scanning is not implemented yet.
 *
 * No environment variable, administrator role or caller-supplied
 * flag can bypass this gate.
 *
 * Replace only after verified scanning and quarantine controls
 * have been implemented and tested end to end.
 */
export function assertChatFileContentScanReady(): void {
  throw new ServiceUnavailableException(
    'Dosya icerik guvenlik taramasi tamamlanmadan bu islem yapilamaz',
  );
}
