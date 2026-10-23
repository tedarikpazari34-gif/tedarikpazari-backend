import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ProductImportStatus, Role } from '@prisma/client';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { lookup } from 'dns/promises';
import { Agent as HttpsAgent } from 'https';
import { isIP } from 'net';
import { PrismaService } from '../prisma.service';
import { ProductImportService } from './product-import.service';

type FeedUser = {
  role: Role;
  companyId: string;
};

type CreateFeedInput = {
  name: string;
  url: string;
  syncIntervalMinutes?: number;
};

type UpdateFeedInput = {
  name?: string;
  url?: string;
  isActive?: boolean;
  syncIntervalMinutes?: number;
};

@Injectable()
export class ProductXmlFeedService {
  private readonly logger = new Logger(ProductXmlFeedService.name);
  private readonly maxXmlBytes = 10 * 1024 * 1024;
  private readonly requestTimeoutMs = 20_000;
  private readonly lockMinutes = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly importService: ProductImportService,
  ) {}

  private normalizeName(value: unknown): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('XML feed adı zorunludur');
    }

    const name = value.trim();

    if (!name || name.length > 120) {
      throw new BadRequestException(
        'XML feed adı 1 ile 120 karakter arasında olmalıdır',
      );
    }

    return name;
  }

  private normalizeInterval(value: unknown): number {
    const interval =
      value === undefined || value === null || value === ''
        ? 60
        : Number(value);

    if (
      !Number.isInteger(interval) ||
      interval < 60 ||
      interval > 10080
    ) {
      throw new BadRequestException(
        'XML senkron aralığı 60 ile 10080 dakika arasında olmalıdır',
      );
    }

    return interval;
  }

  private isBlockedIp(address: string): boolean {
    const normalized = address
      .toLowerCase()
      .replace(/^\[/, '')
      .replace(/\]$/, '');

    if (isIP(normalized) === 4) {
      const parts = normalized.split('.').map(Number);
      const [a, b, c] = parts;

      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 0) ||
        (a === 192 && b === 88 && c === 99) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        a >= 224
      );
    }

    if (isIP(normalized) === 6) {
      if (normalized.startsWith('::ffff:')) {
        const suffix = normalized.slice('::ffff:'.length);

        if (isIP(suffix) === 4) {
          return this.isBlockedIp(suffix);
        }

        const mappedParts = suffix.split(':');

        if (mappedParts.length === 2) {
          const high = Number.parseInt(mappedParts[0], 16);
          const low = Number.parseInt(mappedParts[1], 16);

          if (
            Number.isInteger(high) &&
            Number.isInteger(low) &&
            high >= 0 &&
            high <= 0xffff &&
            low >= 0 &&
            low <= 0xffff
          ) {
            return this.isBlockedIp(
              `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`,
            );
          }
        }
      }

      return (
        normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        normalized.startsWith('fe8') ||
        normalized.startsWith('fe9') ||
        normalized.startsWith('fea') ||
        normalized.startsWith('feb') ||
        normalized.startsWith('ff') ||
        normalized.startsWith('2001:db8:')
      );
    }

    return true;
  }

  private async resolvePublicAddresses(hostname: string) {
    const normalizedHostname = hostname
      .toLowerCase()
      .replace(/^\[/, '')
      .replace(/\]$/, '');

    const literalFamily = isIP(normalizedHostname);

    if (literalFamily) {
      if (this.isBlockedIp(normalizedHostname)) {
        throw new BadRequestException(
          'Özel veya yerel IP adresleri kullanılamaz',
        );
      }

      return [
        {
          address: normalizedHostname,
          family: literalFamily,
        },
      ];
    }

    let addresses: Array<{ address: string; family: number }>;

    try {
      addresses = await lookup(normalizedHostname, {
        all: true,
        verbatim: true,
      });
    } catch {
      throw new BadRequestException('XML feed alan adı çözümlenemedi');
    }

    if (
      addresses.length === 0 ||
      addresses.some((entry) => this.isBlockedIp(entry.address))
    ) {
      throw new BadRequestException(
        'XML feed alan adı özel veya yerel bir IP adresine çözümleniyor',
      );
    }

    return addresses;
  }

  private async validateFeedUrl(rawUrl: unknown): Promise<string> {
    if (typeof rawUrl !== 'string') {
      throw new BadRequestException('Geçerli bir XML feed URL adresi girin');
    }

    let url: URL;

    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw new BadRequestException('Geçerli bir XML feed URL adresi girin');
    }

    if (url.protocol !== 'https:') {
      throw new BadRequestException(
        'XML feed adresi yalnızca HTTPS olabilir',
      );
    }

    if (
      url.username ||
      url.password ||
      url.port ||
      !url.hostname ||
      url.hostname.toLowerCase() === 'localhost'
    ) {
      throw new BadRequestException('XML feed URL adresi güvenli değil');
    }

    await this.resolvePublicAddresses(url.hostname);

    url.hash = '';

    return url.toString();
  }

  private async assertAccess(user: FeedUser) {
    await this.importService.assertImportAccess(user);
  }

  async list(user: FeedUser) {
    await this.assertAccess(user);

    return this.prisma.productXmlFeed.findMany({
      where: { sellerId: user.companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(user: FeedUser, input: CreateFeedInput) {
    await this.assertAccess(user);

    const name = this.normalizeName(input?.name);
    const url = await this.validateFeedUrl(input?.url);
    const syncIntervalMinutes = this.normalizeInterval(
      input?.syncIntervalMinutes,
    );

    const duplicate = await this.prisma.productXmlFeed.findFirst({
      where: {
        sellerId: user.companyId,
        url,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new ConflictException('Bu XML feed adresi zaten kayıtlı');
    }

    return this.prisma.productXmlFeed.create({
      data: {
        sellerId: user.companyId,
        name,
        url,
        syncIntervalMinutes,
        isActive: false,
        nextSyncAt: new Date(),
      },
    });
  }

  async update(user: FeedUser, feedId: string, input: UpdateFeedInput) {
    await this.assertAccess(user);

    const feed = await this.prisma.productXmlFeed.findFirst({
      where: {
        id: feedId,
        sellerId: user.companyId,
      },
    });

    if (!feed) {
      throw new NotFoundException('XML feed bulunamadı');
    }

    const data: Record<string, unknown> = {};

    if (input?.name !== undefined) {
      data.name = this.normalizeName(input.name);
    }

    if (input?.url !== undefined) {
      const url = await this.validateFeedUrl(input.url);

      const duplicate = await this.prisma.productXmlFeed.findFirst({
        where: {
          sellerId: user.companyId,
          url,
          id: { not: feed.id },
        },
        select: { id: true },
      });

      if (duplicate) {
        throw new ConflictException('Bu XML feed adresi zaten kayıtlı');
      }

      data.url = url;
    }

    if (input?.syncIntervalMinutes !== undefined) {
      data.syncIntervalMinutes = this.normalizeInterval(
        input.syncIntervalMinutes,
      );
    }

    if (input?.isActive !== undefined) {
      if (typeof input.isActive !== 'boolean') {
        throw new BadRequestException('XML feed aktiflik değeri geçersiz');
      }

      data.isActive = input.isActive;

      if (input.isActive && !feed.isActive) {
        data.nextSyncAt = new Date();
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Güncellenecek XML feed alanı bulunamadı');
    }

    return this.prisma.productXmlFeed.update({
      where: { id: feed.id },
      data,
    });
  }

  private async downloadXml(url: string): Promise<Buffer> {
    const validatedUrl = await this.validateFeedUrl(url);
    const parsedUrl = new URL(validatedUrl);
    const approvedAddresses = await this.resolvePublicAddresses(
      parsedUrl.hostname,
    );
    const pinnedAddress = approvedAddresses[0];
    const expectedHostname = parsedUrl.hostname
      .toLowerCase()
      .replace(/^\[/, '')
      .replace(/\]$/, '');

    const httpsAgent = new HttpsAgent({
      keepAlive: false,
      lookup: ((hostname: string, _options: unknown, callback: Function) => {
        const requestedHostname = hostname
          .toLowerCase()
          .replace(/^\[/, '')
          .replace(/\]$/, '');

        if (requestedHostname !== expectedHostname) {
          callback(new Error('XML feed DNS hedefi değiştirilemez'));
          return;
        }

        callback(
          null,
          pinnedAddress.address,
          pinnedAddress.family,
        );
      }) as any,
    });

    let response;

    try {
      response = await axios.get<ArrayBuffer>(validatedUrl, {
        responseType: 'arraybuffer',
        timeout: this.requestTimeoutMs,
        maxRedirects: 0,
        maxContentLength: this.maxXmlBytes,
        maxBodyLength: this.maxXmlBytes,
        proxy: false,
        httpsAgent,
        validateStatus: (status) => status >= 200 && status < 300,
        headers: {
          Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
          'User-Agent': 'Nex-Tedarik-Pazari-XML-Sync/1.0',
        },
      });
    } catch (error) {
      const message =
        axios.isAxiosError(error) && error.response?.status
          ? `XML feed indirilemedi (HTTP ${error.response.status})`
          : 'XML feed indirilemedi';

      throw new BadRequestException(message);
    }

    const contentType = String(response.headers?.['content-type'] ?? '')
      .toLowerCase();

    if (
      contentType &&
      !contentType.includes('xml') &&
      !contentType.includes('text/plain') &&
      !contentType.includes('octet-stream')
    ) {
      throw new BadRequestException(
        'XML feed yanıtının içerik türü geçerli değil',
      );
    }

    const buffer = Buffer.from(response.data);

    if (buffer.length === 0) {
      throw new BadRequestException('XML feed boş yanıt döndürdü');
    }

    if (buffer.length > this.maxXmlBytes) {
      throw new BadRequestException('XML feed en fazla 10 MB olabilir');
    }

    return buffer;
  }

  private async acquireLock(feedId: string): Promise<string | null> {
    const token = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.lockMinutes * 60 * 1000,
    );

    const result = await this.prisma.productXmlFeed.updateMany({
      where: {
        id: feedId,
        OR: [
          { syncLockToken: null },
          { syncLockExpiresAt: null },
          { syncLockExpiresAt: { lt: now } },
        ],
      },
      data: {
        syncLockToken: token,
        syncLockExpiresAt: expiresAt,
        lastSyncStartedAt: now,
      },
    });

    return result.count === 1 ? token : null;
  }

  private async refreshLock(feedId: string, token: string) {
    const now = new Date();
    const result = await this.prisma.productXmlFeed.updateMany({
      where: {
        id: feedId,
        syncLockToken: token,
        syncLockExpiresAt: { gt: now },
      },
      data: {
        syncLockExpiresAt: new Date(
          now.getTime() + this.lockMinutes * 60 * 1000,
        ),
      },
    });

    if (result.count !== 1) {
      throw new ConflictException(
        'XML feed senkronizasyon kilidi kaybedildi',
      );
    }
  }

  private async releaseLock(feedId: string, token: string) {
    await this.prisma.productXmlFeed.updateMany({
      where: {
        id: feedId,
        syncLockToken: token,
      },
      data: {
        syncLockToken: null,
        syncLockExpiresAt: null,
      },
    });
  }

  private sellerUser(sellerId: string): FeedUser {
    return {
      role: Role.SELLER,
      companyId: sellerId,
    };
  }

  private async runFeedByRecord(feed: {
    id: string;
    sellerId: string;
    name: string;
    url: string;
    syncIntervalMinutes: number;
  }) {
    const token = await this.acquireLock(feed.id);

    if (!token) {
      throw new ConflictException('Bu XML feed şu anda senkronize ediliyor');
    }

    let heartbeatFailure: Error | null = null;
    let refreshing = false;
    let productsCommitted = false;
    let invalidFeedData = false;

    const heartbeat = setInterval(() => {
      if (refreshing || heartbeatFailure) return;
      refreshing = true;

      void this.refreshLock(feed.id, token)
        .catch((error: unknown) => {
          heartbeatFailure =
            error instanceof Error
              ? error
              : new Error('XML feed kilidi yenilenemedi');
        })
        .finally(() => {
          refreshing = false;
        });
    }, 60_000);

    heartbeat.unref();

    const ensureLock = async () => {
      if (heartbeatFailure) throw heartbeatFailure;
      await this.refreshLock(feed.id, token);
      if (heartbeatFailure) throw heartbeatFailure;
    };

    try {
      await ensureLock();
      const buffer = await this.downloadXml(feed.url);
      await ensureLock();
      const user = this.sellerUser(feed.sellerId);

      const job = await this.importService.createXmlJob(user, {
        originalname: `${feed.name.slice(0, 80) || 'xml-feed'}.xml`,
        buffer,
      }).catch((error: unknown) => {
        if (error instanceof BadRequestException) invalidFeedData = true;
        throw error;
      });

      await ensureLock();

      const jobSaved = await this.prisma.productXmlFeed.updateMany({
        where: {
          id: feed.id,
          syncLockToken: token,
          syncLockExpiresAt: { gt: new Date() },
        },
        data: { lastJobId: job.id },
      });

      if (jobSaved.count !== 1) {
        throw new ConflictException(
          'XML feed senkronizasyon kilidi kaybedildi',
        );
      }

      if (
        job.status !== ProductImportStatus.READY &&
        job.status !== ProductImportStatus.VALIDATED
      ) {
        throw new BadRequestException(
          'XML feed ön kontrolü beklenmeyen bir durum döndürdü',
        );
      }

      if (job.errorRows > 0 || job.status === ProductImportStatus.VALIDATED) {
        invalidFeedData = true;
        throw new BadRequestException(
          `XML feed ön kontrolünde ${job.errorRows} hatalı ürün satırı bulundu; hiçbir değişiklik uygulanmadı`,
        );
      }

      if (job.totalRows > 100) {
        invalidFeedData = true;
        throw new BadRequestException(
          'Otomatik XML için en fazla 100 ürün destekleniyor',
        );
      }

      if (job.status === ProductImportStatus.READY) {
        await ensureLock();
        const result = await this.importService.processFeedJobAtomically(
          user,
          job.id,
          {
            feedId: feed.id,
            lockToken: token,
            syncIntervalMinutes: feed.syncIntervalMinutes,
          },
        );
        productsCommitted = true;
        return result.feed!;
      }
    } catch (error) {
      if (productsCommitted) {
        this.logger.warn(
          `XML ürünleri kaydedildi ancak senkronizasyon durumu tamamlanamadı: ${feed.id}`,
        );
        throw error;
      }

      const message =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'XML feed senkronizasyonu başarısız';

      const now = new Date();
      const nextSyncAt = new Date(
        now.getTime() + feed.syncIntervalMinutes * 60 * 1000,
      );

      try {
        await this.prisma.productXmlFeed.updateMany({
          where: {
            id: feed.id,
            syncLockToken: token,
            syncLockExpiresAt: { gt: now },
          },
          data: {
            lastFailureAt: now,
            lastError: message,
            ...(invalidFeedData ? { isActive: false } : {}),
            nextSyncAt,
          },
        });
      } catch {
        this.logger.warn(
          `XML feed hata durumu kaydedilemedi: ${feed.id}`,
        );
      }

      throw error;
    } finally {
      clearInterval(heartbeat);
      try {
        await this.releaseLock(feed.id, token);
      } catch (error) {
        this.logger.warn(
          `XML feed kilidi bırakılamadı: ${feed.id} - ${String(error)}`,
        );
      }
    }
  }

  async syncNow(user: FeedUser, feedId: string) {
    await this.assertAccess(user);

    const feed = await this.prisma.productXmlFeed.findFirst({
      where: {
        id: feedId,
        sellerId: user.companyId,
      },
      select: {
        id: true,
        sellerId: true,
        name: true,
        url: true,
        syncIntervalMinutes: true,
      },
    });

    if (!feed) {
      throw new NotFoundException('XML feed bulunamadı');
    }

    return this.runFeedByRecord(feed);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async syncDueFeeds() {
    const now = new Date();

    const feeds = await this.prisma.productXmlFeed.findMany({
      where: {
        isActive: true,
        nextSyncAt: { lte: now },
      },
      orderBy: { nextSyncAt: 'asc' },
      take: 10,
      select: {
        id: true,
        sellerId: true,
        name: true,
        url: true,
        syncIntervalMinutes: true,
      },
    });

    for (const feed of feeds) {
      try {
        await this.runFeedByRecord(feed);
      } catch (error) {
        this.logger.warn(
          `XML feed senkronizasyonu başarısız: ${feed.id} - ${
            error instanceof Error ? error.message : 'Bilinmeyen hata'
          }`,
        );
      }
    }
  }
}
