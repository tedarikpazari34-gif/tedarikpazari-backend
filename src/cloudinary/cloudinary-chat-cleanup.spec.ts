import { InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryService } from './cloudinary.service';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      destroy: jest.fn(),
    },
  },
}));

describe('Cloudinary chat cleanup boundaries', () => {
  const destroy = cloudinary.uploader.destroy as jest.Mock;
  const service = new CloudinaryService();

  beforeEach(() => {
    destroy.mockReset();
    destroy.mockResolvedValue({ result: 'ok' });
  });

  it('yalniz sohbet klasorundeki ozel dosyayi siler', async () => {
    await service.deleteChatUpload(
      'tedarik-pazari-platform/chat/safe123.pdf',
      'raw',
      'authenticated',
    );

    expect(destroy).toHaveBeenCalledWith(
      'tedarik-pazari-platform/chat/safe123.pdf',
      {
        resource_type: 'raw',
        type: 'authenticated',
        invalidate: true,
      },
    );
  });

  it('yanlislikla acik yuklenen sohbet dosyasini temizler', async () => {
    await service.deleteChatUpload(
      'tedarik-pazari-platform/chat/public123',
      'image',
      'upload',
    );

    expect(destroy).toHaveBeenCalledWith(
      'tedarik-pazari-platform/chat/public123',
      expect.objectContaining({ type: 'upload' }),
    );
  });

  it.each([
    'tedarik-pazari-platform/invoices/private123',
    'tedarik-pazari-platform/chat/../private123',
    'tedarik-pazari-platform/chat/subfolder/private123',
    'tedarik-pazari-platform/chat/secret%2Ffile',
  ])('guvensiz referansi reddeder: %s', async (id) => {
    await expect(
      service.deleteChatUpload(id, 'raw', 'authenticated'),
    ).rejects.toThrow(InternalServerErrorException);

    expect(destroy).not.toHaveBeenCalled();
  });

  it('beklenmeyen silme yanitini basarili saymaz', async () => {
    destroy.mockResolvedValue({ result: 'error' });

    await expect(
      service.deleteChatUpload(
        'tedarik-pazari-platform/chat/safe123',
        'image',
        'authenticated',
      ),
    ).rejects.toThrow(InternalServerErrorException);
  });
});
