import { InvoiceStorageService } from './invoice-storage.service';
import { v2 as cloudinary } from 'cloudinary';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { destroy: jest.fn(), upload_stream: jest.fn() },
    utils: { private_download_url: jest.fn() },
  },
}));

describe('Invoice storage download security', () => {
  const signedUrl = cloudinary.utils.private_download_url as jest.Mock;
  let service: InvoiceStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    signedUrl.mockReturnValue('https://example.com/signed.pdf');
    service = new InvoiceStorageService();
  });

  it.each([
    'tedarik-pazari-platform/products/product-1',
    'tedarik-pazari-platform/disputes/evidence-1',
    'other-folder/file-1',
    'tedarik-pazari-platform/invoices/',
    '../tedarik-pazari-platform/invoices/file-1',
  ])('rejects unsafe invoice download reference: %s', publicId => {
    expect(() => service.createDownloadUrl({
      publicId,
      resourceType: 'raw',
      deliveryType: 'authenticated',
    }, 'pdf')).toThrow();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('creates a five-minute authenticated PDF link', () => {
    const before = Math.floor(Date.now() / 1000);
    const result = service.createDownloadUrl({
      publicId: 'tedarik-pazari-platform/invoices/invoice-1',
      resourceType: 'raw',
      deliveryType: 'authenticated',
    }, 'pdf');
    const after = Math.floor(Date.now() / 1000);
    const options = signedUrl.mock.calls[0]?.[2];
    expect(options).toEqual(expect.objectContaining({
      resource_type: 'raw',
      type: 'authenticated',
      attachment: true,
    }));
    expect(options.expires_at).toBeGreaterThanOrEqual(before + 300);
    expect(options.expires_at).toBeLessThanOrEqual(after + 300);
    expect(result.url).toBe('https://example.com/signed.pdf');
  });
});

describe('Invoice storage deletion security', () => {
  const destroy = cloudinary.uploader.destroy as jest.Mock;
  let service: InvoiceStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    destroy.mockResolvedValue({ result: 'ok' });
    service = new InvoiceStorageService();
  });

  it.each([
    'tedarik-pazari-platform/products/product-1',
    'tedarik-pazari-platform/disputes/evidence-1',
    'tedarik-pazari-platform/verification-documents/doc-1',
    'other-folder/file-1',
    'tedarik-pazari-platform/invoices/',
    '../tedarik-pazari-platform/invoices/file-1',
    '',
  ])('rejects unsafe invoice deletion reference: %s', async publicId => {
    await expect(service.remove({
      publicId,
      resourceType: 'raw',
      deliveryType: 'authenticated',
    })).rejects.toThrow();
    expect(destroy).not.toHaveBeenCalled();
  });
});


describe('Invoice storage valid deletion', () => {
  const destroy = cloudinary.uploader.destroy as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    destroy.mockResolvedValue({ result: 'ok' });
  });

  it('deletes a valid authenticated invoice PDF', async () => {
    const service = new InvoiceStorageService();
    const publicId = 'tedarik-pazari-platform/invoices/invoice-1';

    await expect(service.remove({
      publicId,
      resourceType: 'raw',
      deliveryType: 'authenticated',
    })).resolves.toBeUndefined();

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledWith(publicId, {
      resource_type: 'raw',
      type: 'authenticated',
      invalidate: true,
    });
  });
});

describe('Invoice storage deletion result handling', () => {
  const destroy = cloudinary.uploader.destroy as jest.Mock;
  const file = {
    publicId: 'tedarik-pazari-platform/invoices/invoice-1',
    resourceType: 'raw' as const,
    deliveryType: 'authenticated' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an unsuccessful Cloudinary deletion result', async () => {
    destroy.mockResolvedValue({ result: 'error' });
    await expect(new InvoiceStorageService().remove(file))
      .rejects.toThrow('Fatura dosya temizligi dogrulanamadi');
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('accepts an already missing invoice file', async () => {
    destroy.mockResolvedValue({ result: 'not found' });
    await expect(new InvoiceStorageService().remove(file))
      .resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('Invoice storage upload security', () => {
  const uploadStream = cloudinary.uploader.upload_stream as jest.Mock;
  let service: InvoiceStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new InvoiceStorageService();
  });

  function mockUpload(publicId: string) {
    uploadStream.mockImplementation((options, callback) => ({
      end: jest.fn(() => callback(null, {
        public_id: publicId,
        resource_type: 'raw',
        type: 'authenticated',
      })),
    }));
  }

  it('uploads PDF with authenticated private storage options', async () => {
    const publicId = 'tedarik-pazari-platform/invoices/invoice-1';
    mockUpload(publicId);
    const stored = await service.upload(Buffer.from('%PDF-1.7'), 'raw');
    expect(uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'tedarik-pazari-platform/invoices',
        resource_type: 'raw',
        type: 'authenticated',
        overwrite: false,
        unique_filename: true,
      }),
      expect.any(Function),
    );
    expect(stored).toEqual({
      publicId,
      resourceType: 'raw',
      deliveryType: 'authenticated',
    });
  });

  it('rejects uploaded files outside invoice folder', async () => {
    mockUpload('tedarik-pazari-platform/products/product-1');
    await expect(service.upload(Buffer.from('%PDF-1.7'), 'raw'))
      .rejects.toThrow();
  });
});

describe('Invoice storage upload cleanup security', () => {
  const uploadStream = cloudinary.uploader.upload_stream as jest.Mock;
  const destroy = cloudinary.uploader.destroy as jest.Mock;
  const publicId = 'tedarik-pazari-platform/invoices/invoice-cleanup-1';

  beforeEach(() => {
    jest.clearAllMocks();
    uploadStream.mockImplementation((_options, callback) => ({
      end: jest.fn(() => callback(null, {
        public_id: publicId,
        resource_type: 'image',
        type: 'authenticated',
      })),
    }));
  });

  it('cleans up authenticated file with unexpected resource type', async () => {
    destroy.mockResolvedValue({ result: 'ok' });
    await expect(new InvoiceStorageService().upload(Buffer.from('%PDF-1.7'), 'raw'))
      .rejects.toThrow('Cloudinary ozel erisim dogrulanamadi');
    expect(destroy).toHaveBeenCalledWith(publicId, {
      resource_type: 'image',
      type: 'authenticated',
      invalidate: true,
    });
  });

  it('requires manual review when upload cleanup fails', async () => {
    destroy.mockResolvedValue({ result: 'error' });
    await expect(new InvoiceStorageService().upload(Buffer.from('%PDF-1.7'), 'raw'))
      .rejects.toThrow('manuel inceleme gerekli');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
