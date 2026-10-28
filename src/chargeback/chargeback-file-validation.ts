import { BadRequestException } from '@nestjs/common';

export type ChargebackFileKind = 'image' | 'raw';

export function validateChargebackFile(
  buffer: Buffer,
  mimeType: string,
): ChargebackFileKind {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw new BadRequestException('Gecersiz belge icerigi');
  }

  if (mimeType === 'application/pdf') {
    const header = buffer.subarray(0, 5).toString('ascii');
    const trailer = buffer.toString('latin1').trimEnd();

    if (header !== '%PDF-' || !trailer.endsWith('%%EOF')) {
      throw new BadRequestException('PDF dosya imzasi gecersiz');
    }

    return 'raw';
  }

  if (mimeType === 'image/png') {
    const signature = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);

    if (!buffer.subarray(0, 8).equals(signature)) {
      throw new BadRequestException('PNG dosya imzasi gecersiz');
    }

    return 'image';
  }

  if (mimeType === 'image/jpeg') {
    if (
      buffer[0] !== 0xff ||
      buffer[1] !== 0xd8 ||
      buffer[buffer.length - 2] !== 0xff ||
      buffer[buffer.length - 1] !== 0xd9
    ) {
      throw new BadRequestException('JPEG dosya imzasi gecersiz');
    }

    return 'image';
  }

  if (mimeType === 'image/webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');

    if (riff !== 'RIFF' || webp !== 'WEBP') {
      throw new BadRequestException('WEBP dosya imzasi gecersiz');
    }

    return 'image';
  }

  throw new BadRequestException('Desteklenmeyen belge turu');
}
