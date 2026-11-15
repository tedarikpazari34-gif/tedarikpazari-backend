import { BadRequestException } from '@nestjs/common';

export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type ValidatedChatFile = {
  mimeType: string;
  extension: 'jpg' | 'png' | 'webp' | 'pdf';
  displayName: string;
  resourceType: 'image' | 'raw';
};

export function validateChatFile(
  file: Pick<Express.Multer.File, 'buffer' | 'size' | 'mimetype'> | undefined,
): ValidatedChatFile {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > CHAT_FILE_MAX_BYTES ||
    file.buffer.length !== file.size
  ) {
    throw new BadRequestException('Geçersiz dosya veya dosya boyutu');
  }

  const buffer = file.buffer;

  const isJpeg =
    buffer.length >= 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const isPng =
    buffer.length >= 12 &&
    buffer.subarray(0, 8).equals(pngSignature);

  const isWebp =
    buffer.length >= 16 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';

  const isPdf =
    buffer.length >= 9 &&
    /^%PDF-(1\.[0-7]|2\.0)/.test(
      buffer.toString('ascii', 0, 8),
    );

  if (file.mimetype === 'image/jpeg' && isJpeg) {
    return {
      mimeType: 'image/jpeg',
      extension: 'jpg',
      displayName: 'Gorsel.jpg',
      resourceType: 'image',
    };
  }

  if (file.mimetype === 'image/png' && isPng) {
    return {
      mimeType: 'image/png',
      extension: 'png',
      displayName: 'Gorsel.png',
      resourceType: 'image',
    };
  }

  if (file.mimetype === 'image/webp' && isWebp) {
    return {
      mimeType: 'image/webp',
      extension: 'webp',
      displayName: 'Gorsel.webp',
      resourceType: 'image',
    };
  }

  if (file.mimetype === 'application/pdf' && isPdf) {
    return {
      mimeType: 'application/pdf',
      extension: 'pdf',
      displayName: 'Belge.pdf',
      resourceType: 'raw',
    };
  }

  throw new BadRequestException(
    'Dosya türü veya dosya içeriği geçersiz',
  );
}
