import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  ChatFileStorageService,
  isValidChatStorageReference,
} from './chat-file-storage.service';

describe('Private chat file storage security', () => {
  const pdf = Buffer.from(
    '%PDF-1.7\\n1 0 obj\\n<<>>\\nendobj\\n',
  );

  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46,
  ]);

  const uploadBuffer = jest.fn();
  const deleteChatUpload = jest.fn();

  const storage = new ChatFileStorageService(
    { uploadBuffer, deleteChatUpload } as unknown as CloudinaryService,
  );

  const makeFile = (
    buffer: Buffer,
    mimetype: string,
  ) => ({
    buffer,
    size: buffer.length,
    mimetype,
    originalname: 'ozel-kimlik-ve-telefon.pdf',
  });

  beforeEach(() => {
    uploadBuffer.mockReset();
    deleteChatUpload.mockReset();
    deleteChatUpload.mockResolvedValue(undefined);
  });

  it('PDF dosyasini ozel Cloudinary alanina yollar', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/chat/random123.pdf',
      resource_type: 'raw',
      type: 'authenticated',
    });

    const result = await storage.upload(
      makeFile(pdf, 'application/pdf'),
    );

    expect(uploadBuffer).toHaveBeenCalledWith(
      pdf,
      expect.objectContaining({
        folder: 'tedarik-pazari-platform/chat',
        resource_type: 'raw',
        type: 'authenticated',
        overwrite: false,
        use_filename: false,
        unique_filename: true,
      }),
    );

    expect(result.publicId).toBe(
      'tedarik-pazari-platform/chat/random123.pdf',
    );

    expect(result.displayName).toBe('Belge.pdf');

    expect(JSON.stringify(result)).not.toContain(
      'ozel-kimlik-ve-telefon',
    );
  });

  it('gorselleri ozel image turunde yukler', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/chat/random456',
      resource_type: 'image',
      type: 'authenticated',
    });

    const result = await storage.upload(
      makeFile(jpeg, 'image/jpeg'),
    );

    expect(result.resourceType).toBe('image');
    expect(result.displayName).toBe('Gorsel.jpg');

    expect(uploadBuffer).toHaveBeenCalledWith(
      jpeg,
      expect.objectContaining({
        resource_type: 'image',
        type: 'authenticated',
      }),
    );
  });

  it('herkese acik Cloudinary sonucunu reddeder', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/chat/random123',
      resource_type: 'image',
      type: 'upload',
    });

    await expect(
      storage.upload(makeFile(jpeg, 'image/jpeg')),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('yanlis Cloudinary kaynak turunu reddeder', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/chat/random123',
      resource_type: 'raw',
      type: 'authenticated',
    });

    await expect(
      storage.upload(makeFile(jpeg, 'image/jpeg')),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('baska klasordeki dosya referansini reddeder', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/invoices/random123',
      resource_type: 'raw',
      type: 'authenticated',
    });

    await expect(
      storage.upload(makeFile(pdf, 'application/pdf')),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('guvensiz dosya yolunu reddeder', () => {
    expect(
      isValidChatStorageReference(
        'tedarik-pazari-platform/chat/../secret',
      ),
    ).toBe(false);

    expect(
      isValidChatStorageReference(
        'tedarik-pazari-platform/chat/private/secret',
      ),
    ).toBe(false);

    expect(
      isValidChatStorageReference(
        'tedarik-pazari-platform/chat/abc.pdf',
      ),
    ).toBe(true);
  });

  it('sahte PDF yuklemesini Cloudinary oncesinde reddeder', async () => {
    await expect(
      storage.upload(
        makeFile(
          Buffer.from('NOT A PDF'),
          'application/pdf',
        ),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(uploadBuffer).not.toHaveBeenCalled();
  });

  it('Cloudinary hatasini basarili saymaz', async () => {
    uploadBuffer.mockRejectedValue(
      new Error('MOCK STORAGE FAILURE'),
    );

    await expect(
      storage.upload(makeFile(pdf, 'application/pdf')),
    ).rejects.toThrow('MOCK STORAGE FAILURE');
  });

  it('basarili ozel yuklemede temizleme yapmaz', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/chat/safe123',
      resource_type: 'image',
      type: 'authenticated',
    });

    await storage.upload(makeFile(jpeg, 'image/jpeg'));

    expect(deleteChatUpload).not.toHaveBeenCalled();
  });

  it('herkese acik yukleme yanitini temizler ve reddeder', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/chat/public123',
      resource_type: 'image',
      type: 'upload',
    });

    await expect(
      storage.upload(makeFile(jpeg, 'image/jpeg')),
    ).rejects.toThrow(InternalServerErrorException);

    expect(deleteChatUpload).toHaveBeenCalledWith(
      'tedarik-pazari-platform/chat/public123',
      'image',
      'upload',
    );
  });

  it('temizleme basarisizsa manuel inceleme hatasi verir', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/chat/public123',
      resource_type: 'image',
      type: 'upload',
    });

    deleteChatUpload.mockRejectedValue(new Error('MOCK DELETE ERROR'));

    await expect(
      storage.upload(makeFile(jpeg, 'image/jpeg')),
    ).rejects.toThrow('manuel inceleme gerekli');
  });

  it('baska klasordeki dosyayi otomatik silmeye calismaz', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/invoices/important123',
      resource_type: 'raw',
      type: 'authenticated',
    });

    await expect(
      storage.upload(makeFile(pdf, 'application/pdf')),
    ).rejects.toThrow(InternalServerErrorException);

    expect(deleteChatUpload).not.toHaveBeenCalled();
  });

  it('bilinmeyen depolama turunu otomatik silmez', async () => {
    uploadBuffer.mockResolvedValue({
      public_id: 'tedarik-pazari-platform/chat/unknown123',
      resource_type: 'video',
      type: 'upload',
    });

    await expect(
      storage.upload(makeFile(pdf, 'application/pdf')),
    ).rejects.toThrow(InternalServerErrorException);

    expect(deleteChatUpload).not.toHaveBeenCalled();
  });
});
