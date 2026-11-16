import { InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    utils: {
      private_download_url: jest.fn(),
    },
    uploader: {
      destroy: jest.fn(),
      upload_stream: jest.fn(),
    },
  },
}));

describe('Private chat download URL security', () => {
  const sign = cloudinary.utils.private_download_url as jest.Mock;
  const service = new CloudinaryService();

  beforeEach(() => {
    sign.mockReset();
    sign.mockReturnValue(
      'https://res.cloudinary.com/mock/private-file',
    );
  });

  it('PDF icin authenticated baglanti olusturur', () => {
    const result = service.createChatDownloadUrl(
      'tedarik-pazari-platform/chat/random123.pdf',
      'raw',
      'pdf',
    );

    expect(result.url.startsWith('https://')).toBe(true);

    expect(sign).toHaveBeenCalledWith(
      'tedarik-pazari-platform/chat/random123.pdf',
      'pdf',
      expect.objectContaining({
        resource_type: 'raw',
        type: 'authenticated',
        attachment: true,
      }),
    );
  });

  it('gorsel icin authenticated baglanti olusturur', () => {
    service.createChatDownloadUrl(
      'tedarik-pazari-platform/chat/random456',
      'image',
      'jpg',
    );

    expect(sign).toHaveBeenCalledWith(
      'tedarik-pazari-platform/chat/random456',
      'jpg',
      expect.objectContaining({
        resource_type: 'image',
        type: 'authenticated',
      }),
    );
  });

  it('baglantiyi 5 dakika ile sinirlar', () => {
    const before = Math.floor(Date.now() / 1000);

    const result = service.createChatDownloadUrl(
      'tedarik-pazari-platform/chat/random123.pdf',
      'raw',
      'pdf',
    );

    const options = sign.mock.calls[0][2];

    expect(options.expires_at).toBeGreaterThanOrEqual(
      before + 300,
    );

    expect(options.expires_at).toBeLessThanOrEqual(
      Math.floor(Date.now() / 1000) + 300,
    );

    expect(result.expiresAt).toBe(
      new Date(options.expires_at * 1000).toISOString(),
    );
  });

  it.each([
    'tedarik-pazari-platform/invoices/secret',
    'tedarik-pazari-platform/disputes/secret',
    'tedarik-pazari-platform/chat/../secret',
    'tedarik-pazari-platform/chat/folder/secret',
    'tedarik-pazari-platform/chat/secret%2Ffile',
  ])('baska veya guvensiz dosya yolunu reddeder: %s', (id) => {
    expect(() =>
      service.createChatDownloadUrl(id, 'raw', 'pdf'),
    ).toThrow(InternalServerErrorException);

    expect(sign).not.toHaveBeenCalled();
  });

  it('PDF dosyasini gorsel olarak acmaz', () => {
    expect(() =>
      service.createChatDownloadUrl(
        'tedarik-pazari-platform/chat/random123.pdf',
        'image',
        'jpg',
      ),
    ).toThrow(InternalServerErrorException);

    expect(sign).not.toHaveBeenCalled();
  });

  it('raw dosyada PDF disindaki formati reddeder', () => {
    expect(() =>
      service.createChatDownloadUrl(
        'tedarik-pazari-platform/chat/random123.pdf',
        'raw',
        'jpg',
      ),
    ).toThrow(InternalServerErrorException);

    expect(sign).not.toHaveBeenCalled();
  });

  it('gorselde PDF formatini reddeder', () => {
    expect(() =>
      service.createChatDownloadUrl(
        'tedarik-pazari-platform/chat/random456',
        'image',
        'pdf',
      ),
    ).toThrow(InternalServerErrorException);

    expect(sign).not.toHaveBeenCalled();
  });

  it('guvensiz HTTP baglantisini reddeder', () => {
    sign.mockReturnValue(
      'http://res.cloudinary.com/mock/private-file',
    );

    expect(() =>
      service.createChatDownloadUrl(
        'tedarik-pazari-platform/chat/random456',
        'image',
        'png',
      ),
    ).toThrow(InternalServerErrorException);
  });

  it('bos imzali baglantiyi reddeder', () => {
    sign.mockReturnValue('');

    expect(() =>
      service.createChatDownloadUrl(
        'tedarik-pazari-platform/chat/random456',
        'image',
        'webp',
      ),
    ).toThrow(InternalServerErrorException);
  });
});
