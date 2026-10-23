import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ProductImportStatus, Role } from '@prisma/client';
import { ProductXmlFeedService } from './product-xml-feed.service';

describe('ProductXmlFeedService', () => {
  const prisma = {
    productXmlFeed: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const importService = {
    assertImportAccess: jest.fn(),
    createXmlJob: jest.fn(),
    confirmJob: jest.fn(),
    getJob: jest.fn(),
    processNextBatch: jest.fn(),
    processFeedJobAtomically: jest.fn(),
  };

  const user = {
    role: Role.SELLER,
    companyId: 'seller-1',
  };

  let service: ProductXmlFeedService;

  beforeEach(() => {
    jest.clearAllMocks();

    importService.assertImportAccess.mockResolvedValue(undefined);

    service = new ProductXmlFeedService(
      prisma as never,
      importService as never,
    );
  });

  it('HTTP feed adresini reddeder', async () => {
    await expect(
      service.create(user, {
        name: 'Test',
        url: 'http://example.com/feed.xml',
      }),
    ).rejects.toThrow('XML feed adresi yalnızca HTTPS olabilir');

    expect(prisma.productXmlFeed.create).not.toHaveBeenCalled();
  });

  it('localhost feed adresini reddeder', async () => {
    await expect(
      service.create(user, {
        name: 'Test',
        url: 'https://localhost/feed.xml',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.productXmlFeed.create).not.toHaveBeenCalled();
  });

  it('özel IPv4 feed adresini reddeder', async () => {
    await expect(
      service.create(user, {
        name: 'Test',
        url: 'https://127.0.0.1/feed.xml',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.productXmlFeed.create).not.toHaveBeenCalled();
  });

  it('IPv4-mapped yerel IPv6 adresini reddeder', async () => {
    await expect(
      service.create(user, {
        name: 'Test',
        url: 'https://[::ffff:127.0.0.1]/feed.xml',
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.productXmlFeed.create).not.toHaveBeenCalled();
  });

  it('60 dakikanın altındaki senkron aralığını reddeder', async () => {
    await expect(
      service.create(user, {
        name: 'Test',
        url: 'https://example.com/feed.xml',
        syncIntervalMinutes: 30,
      }),
    ).rejects.toThrow(
      'XML senkron aralığı 60 ile 10080 dakika arasında olmalıdır',
    );
  });

  it('kilit alınamazsa aynı feed ikinci kez çalıştırılmaz', async () => {
    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1',
      sellerId: user.companyId,
      name: 'Test',
      url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });

    prisma.productXmlFeed.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.syncNow(user, 'feed-1')).rejects.toThrow(
      ConflictException,
    );

    expect(importService.createXmlJob).not.toHaveBeenCalled();
  });

  it('kilit kaybolursa XML içe aktarımını başlatmaz', async () => {
    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1',
      sellerId: user.companyId,
      name: 'Test',
      url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });

    prisma.productXmlFeed.updateMany
      .mockResolvedValue({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(service.syncNow(user, 'feed-1')).rejects.toThrow(
      'XML feed senkronizasyon kilidi kaybedildi',
    );

    expect(importService.createXmlJob).not.toHaveBeenCalled();
    expect(importService.confirmJob).not.toHaveBeenCalled();
    expect(importService.processNextBatch).not.toHaveBeenCalled();
  });

  it('tek bir hatalı satır varsa otomatik içe aktarmayı başlatmaz', async () => {
    const anyService = service as any;

    jest
      .spyOn(anyService, 'downloadXml')
      .mockResolvedValue(Buffer.from('<products></products>'));

    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1',
      sellerId: user.companyId,
      name: 'Test',
      url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });

    prisma.productXmlFeed.updateMany.mockResolvedValue({ count: 1 });
    prisma.productXmlFeed.update.mockResolvedValue({});

    importService.createXmlJob.mockResolvedValue({
      id: 'job-error',
      status: ProductImportStatus.READY,
      errorRows: 1,
    });

    await expect(service.syncNow(user, 'feed-1')).rejects.toThrow(
      '1 hatalı ürün satırı bulundu; hiçbir değişiklik uygulanmadı',
    );

    expect(importService.confirmJob).not.toHaveBeenCalled();
    expect(importService.processNextBatch).not.toHaveBeenCalled();

    expect(prisma.productXmlFeed.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'feed-1',
          syncLockToken: expect.any(String),
        }),
        data: expect.objectContaining({
          lastJobId: 'job-error',
        }),
      }),
    );
  });

  it('işlem sırasında hata oluşursa feed başarısız kaydedilir', async () => {
    const anyService = service as any;

    jest
      .spyOn(anyService, 'downloadXml')
      .mockResolvedValue(Buffer.from('<products></products>'));

    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1',
      sellerId: user.companyId,
      name: 'Test',
      url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });

    prisma.productXmlFeed.updateMany.mockResolvedValue({ count: 1 });
    prisma.productXmlFeed.update.mockResolvedValue({});

    importService.createXmlJob.mockResolvedValue({
      id: 'job-runtime-error',
      status: ProductImportStatus.READY,
      errorRows: 0,
    });

    importService.confirmJob.mockResolvedValue({});
      importService.processFeedJobAtomically.mockRejectedValueOnce(
        new Error('Geçici veritabanı hatası'),
      );

    await expect(service.syncNow(user, 'feed-1')).rejects.toThrow(
      'Geçici veritabanı hatası',
    );

    expect(prisma.productXmlFeed.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastJobId: 'job-runtime-error',
        }),
      }),
    );

    expect(prisma.productXmlFeed.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastFailureAt: expect.any(Date),
            nextSyncAt: expect.any(Date),
        }),
      }),
    );
    expect(prisma.productXmlFeed.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );

  });

  it('mevcut XML import motorunu kullanarak feed işini tamamlar', async () => {
    const anyService = service as any;

    jest
      .spyOn(anyService, 'downloadXml')
      .mockResolvedValue(Buffer.from('<products></products>'));

    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1',
      sellerId: user.companyId,
      name: 'Test',
      url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });

    prisma.productXmlFeed.updateMany.mockResolvedValue({ count: 1 });

    importService.createXmlJob.mockResolvedValue({
      id: 'job-1',
      status: ProductImportStatus.READY,
      errorRows: 0,
    });

    importService.confirmJob.mockResolvedValue({
      id: 'job-1',
      status: ProductImportStatus.IMPORTING,
    });

    importService.getJob.mockResolvedValue({
      id: 'job-1',
      status: ProductImportStatus.IMPORTING,
    });

    importService.processNextBatch.mockResolvedValue({
      id: 'job-1',
      status: ProductImportStatus.COMPLETED,
      remainingRows: 0,
    });

    prisma.productXmlFeed.update.mockResolvedValue({});
    prisma.productXmlFeed.findUniqueOrThrow.mockResolvedValue({
      id: 'feed-1',
      lastJobId: 'job-1',
    });

    importService.processFeedJobAtomically.mockResolvedValue({
      id: 'job-1',
      status: ProductImportStatus.COMPLETED,
      feed: { id: 'feed-1', lastJobId: 'job-1' },
    });

    const result = await service.syncNow(user, 'feed-1');

    expect(importService.createXmlJob).toHaveBeenCalled();
    expect(importService.processFeedJobAtomically).toHaveBeenCalledWith(
      user,
      'job-1',
      expect.objectContaining({
        feedId: 'feed-1',
        lockToken: expect.any(String),
        syncIntervalMinutes: 60,
      }),
    );
    expect(importService.confirmJob).not.toHaveBeenCalled();
    expect(importService.processNextBatch).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: 'feed-1',
        lastJobId: 'job-1',
      }),
    );
  });

  it('atomik işlem sonrası ek sonuç okuması yapılmaz ve feed pasifleştirilmez', async () => {
    const anyService = service as any;

    jest.spyOn(anyService, 'downloadXml')
      .mockResolvedValue(Buffer.from('<products></products>'));

    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1',
      sellerId: user.companyId,
      name: 'Test',
      url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });

    prisma.productXmlFeed.updateMany.mockResolvedValue({ count: 1 });
    prisma.productXmlFeed.findUniqueOrThrow.mockRejectedValueOnce(
      new Error('XML bağlantısının son durumu okunamadı'),
    );

    importService.createXmlJob.mockResolvedValue({
      id: 'job-committed',
      status: ProductImportStatus.READY,
      errorRows: 0,
    });

    importService.processFeedJobAtomically.mockResolvedValue({
      id: 'job-committed',
      status: ProductImportStatus.COMPLETED,
      feed: { id: 'feed-1', lastJobId: 'job-committed' },
    });

    const result = await service.syncNow(user, 'feed-1');
    expect(result.lastJobId).toBe('job-committed');
    expect(prisma.productXmlFeed.findUniqueOrThrow).not.toHaveBeenCalled();

    expect(importService.processFeedJobAtomically).toHaveBeenCalled();

    expect(prisma.productXmlFeed.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );
  });


  it('kilit bırakma hatası başarılı XML senkronizasyonunu bozmaz', async () => {
    const anyService = service as any;
    jest.spyOn(anyService, 'downloadXml')
      .mockResolvedValue(Buffer.from('<products></products>'));
    const releaseLock = jest.spyOn(anyService, 'releaseLock')
      .mockRejectedValue(new Error('Kilit bırakma hatası'));

    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1', sellerId: user.companyId,
      name: 'Test',
      url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });
    prisma.productXmlFeed.updateMany.mockResolvedValue({ count: 1 });
    prisma.productXmlFeed.update.mockResolvedValue({});
    importService.createXmlJob.mockResolvedValue({
      id: 'job-1', status: ProductImportStatus.READY, errorRows: 0,
    });
    importService.processFeedJobAtomically.mockResolvedValue({
      id: 'job-1', status: ProductImportStatus.COMPLETED,
      feed: { id: 'feed-1', lastJobId: 'job-1' },
    });

    await expect(service.syncNow(user, 'feed-1')).resolves.toMatchObject({
      id: 'feed-1', lastJobId: 'job-1',
    });
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(prisma.productXmlFeed.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );
  });


  it('101 ürün içeren XML feed bağlantısını durdurur', async () => {
    jest.spyOn(service as any, 'downloadXml')
      .mockResolvedValue(Buffer.from('<products></products>'));

    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1', sellerId: user.companyId,
      name: 'Test', url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });
    prisma.productXmlFeed.updateMany.mockResolvedValue({ count: 1 });
    importService.createXmlJob.mockResolvedValue({
      id: 'job-101', status: ProductImportStatus.READY,
      errorRows: 0, totalRows: 101,
    });

    await expect(service.syncNow(user, 'feed-1'))
      .rejects.toThrow('Otomatik XML için en fazla 100 ürün');

    expect(importService.processFeedJobAtomically)
      .not.toHaveBeenCalled();
    expect(prisma.productXmlFeed.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isActive: false }),
      }),
    );
  });


  it('bozuk XML dosyasında feed bağlantısını durdurur', async () => {
    jest.spyOn(service as any, 'downloadXml')
      .mockResolvedValue(Buffer.from('<products>bozuk'));

    prisma.productXmlFeed.findFirst.mockResolvedValue({
      id: 'feed-1', sellerId: user.companyId,
      name: 'Test', url: 'https://example.com/feed.xml',
      syncIntervalMinutes: 60,
    });
    prisma.productXmlFeed.updateMany.mockResolvedValue({ count: 1 });

    importService.createXmlJob.mockRejectedValueOnce(
      new BadRequestException('XML dosyası geçerli değil veya bozuk'),
    );

    await expect(service.syncNow(user, 'feed-1'))
      .rejects.toThrow('XML dosyası geçerli değil veya bozuk');

    expect(importService.processFeedJobAtomically)
      .not.toHaveBeenCalled();

    expect(prisma.productXmlFeed.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isActive: false,
          lastFailureAt: expect.any(Date),
        }),
      }),
    );
  });

});
