import { BadRequestException } from '@nestjs/common';
import {
  CHAT_FILE_MAX_BYTES,
  validateChatFile,
} from './chat-file-policy';

const makeFile = (buffer: Buffer, mimetype: string) => ({
  buffer,
  mimetype,
  size: buffer.length,
  originalname: 'ozel-telefon-ve-kimlik.pdf',
});

describe('Chat file security policy', () => {
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46,
  ]);

  const png = Buffer.concat([
    Buffer.from([
      0x89, 0x50, 0x4e, 0x47,
      0x0d, 0x0a, 0x1a, 0x0a,
    ]),
    Buffer.alloc(8),
  ]);

  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46,
    0x08, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20,
  ]);

  const pdf = Buffer.from(
    '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n',
  );

  it.each([
    ['image/jpeg', jpeg, 'jpg', 'Gorsel.jpg'],
    ['image/png', png, 'png', 'Gorsel.png'],
    ['image/webp', webp, 'webp', 'Gorsel.webp'],
    ['application/pdf', pdf, 'pdf', 'Belge.pdf'],
  ])(
    '%s gerçek dosya imzasını kabul eder',
    (mime, bytes, extension, displayName) => {
      const result = validateChatFile(makeFile(bytes, mime));

      expect(result.extension).toBe(extension);
      expect(result.displayName).toBe(displayName);
    },
  );

  it('sahte PDF dosyasını reddeder', () => {
    expect(() =>
      validateChatFile(
        makeFile(Buffer.from('NOT A PDF'), 'application/pdf'),
      ),
    ).toThrow(BadRequestException);
  });

  it('dosya türü ve içerik uyuşmazlığını reddeder', () => {
    expect(() =>
      validateChatFile(makeFile(pdf, 'image/png')),
    ).toThrow(BadRequestException);
  });

  it('izin verilmeyen dosya türünü reddeder', () => {
    expect(() =>
      validateChatFile(makeFile(pdf, 'application/zip')),
    ).toThrow(BadRequestException);
  });

  it('boş dosyayı reddeder', () => {
    expect(() =>
      validateChatFile(
        makeFile(Buffer.alloc(0), 'application/pdf'),
      ),
    ).toThrow(BadRequestException);
  });

  it('10 MB üzerindeki dosyayı reddeder', () => {
    expect(() =>
      validateChatFile(
        makeFile(
          Buffer.alloc(CHAT_FILE_MAX_BYTES + 1),
          'image/png',
        ),
      ),
    ).toThrow(BadRequestException);
  });

  it('yanlış dosya boyutu bilgisini reddeder', () => {
    expect(() =>
      validateChatFile({
        ...makeFile(pdf, 'application/pdf'),
        size: 1,
      }),
    ).toThrow(BadRequestException);
  });

  it('orijinal dosya adını sonuçta göstermez', () => {
    const result = validateChatFile(
      makeFile(pdf, 'application/pdf'),
    );

    expect(JSON.stringify(result)).not.toContain(
      'ozel-telefon-ve-kimlik',
    );
  });

  it('eksik dosyayı reddeder', () => {
    expect(() =>
      validateChatFile(undefined),
    ).toThrow(BadRequestException);
  });
});
