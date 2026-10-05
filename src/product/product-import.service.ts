import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanyStatus,
  Prisma,
  ProductImportRowAction,
  ProductImportSource,
  ProductImportStatus,
  Role,
} from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';

type ImportUser = {
  role: Role;
  companyId: string;
};

type NormalizedProductRow = {
  productId: string | null;
  sku: string;
  title: string;
  description: string | null;
  categoryId: string | null;
  categoryPath: string | null;
  sourceLanguage: string;
  country: string | null;
  city: string | null;
  unitType: string;
  moq: number;
  quantityStep: number;
  basePrice: number;
  leadTimeDays: number | null;
  stockType: string | null;
  stockQuantity: number | null;
  vatRate: number | null;
  imageUrlsProvided: boolean;
  imageUrls: string[];
};

@Injectable()
export class ProductImportService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireVerifiedSellerCompany(user: ImportUser) {
    if (user.role !== Role.SELLER) {
      throw new ForbiddenException('Bu işlem yalnızca satıcı firmalar içindir');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: {
        id: true,
        status: true,
        verified: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Satıcı firması bulunamadı');
    }

    if (company.status !== CompanyStatus.APPROVED) {
      throw new ForbiddenException(
        'Firmanız onaylanmadan ürün içe aktaramazsınız',
      );
    }

    if (!company.verified) {
      throw new ForbiddenException(
        'Firma doğrulaması tamamlanmadan ürün içe aktaramazsınız',
      );
    }

    return company;
  }

  async assertImportAccess(user: ImportUser): Promise<void> {
    await this.requireVerifiedSellerCompany(user);
  }

  private text(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object' && value && 'text' in value) {
      return String((value as { text?: unknown }).text ?? '').trim();
    }
    return String(value).trim();
  }

  private nullableText(value: unknown): string | null {
    const result = this.text(value);
    return result.length > 0 ? result : null;
  }

  private integer(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private decimal(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;

    const normalized =
      typeof value === 'string'
        ? value.trim().replace(/\s/g, '').replace(',', '.')
        : value;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private readonly headerAliases: Record<string, keyof NormalizedProductRow> = {
    urunid: 'productId',
    productid: 'productId',

    sku: 'sku',
    urunkodu: 'sku',
    stokkodu: 'sku',

    urunadi: 'title',
    urunismi: 'title',
    baslik: 'title',

    aciklama: 'description',

    kategoriyolu: 'categoryPath',
    kategori: 'categoryPath',

    birim: 'unitType',
    birimtipi: 'unitType',

    fiyat: 'basePrice',
    birimfiyat: 'basePrice',

    kdv: 'vatRate',
    kdvoran: 'vatRate',
    kdvorani: 'vatRate',

    minimumsiparis: 'moq',
    minimumsiparismiktari: 'moq',
    moq: 'moq',

    siparisartismiktari: 'quantityStep',
    miktaradimi: 'quantityStep',
    quantitystep: 'quantityStep',

    stok: 'stockQuantity',
    stokmiktari: 'stockQuantity',

    stoktipi: 'stockType',

    termin: 'leadTimeDays',
    termingun: 'leadTimeDays',
    terminsuresi: 'leadTimeDays',

    gorselurl: 'imageUrls',
    gorselurlleri: 'imageUrls',
    resimurl: 'imageUrls',
    resimurlleri: 'imageUrls',

    ulke: 'country',
    sehir: 'city',

    kaynakdil: 'sourceLanguage',
    dil: 'sourceLanguage',
  };

  private parseImageUrls(value: unknown): string[] {
    const raw = this.text(value);
    if (!raw) return [];

    const unique = new Set<string>();

    for (const part of raw.split(/[|;\n\r]+/)) {
      const candidate = part.trim();
      if (!candidate) continue;

      try {
        const url = new URL(candidate);
        if (url.protocol !== 'https:') {
          continue;
        }
        unique.add(url.toString());
      } catch {
        continue;
      }
    }

    return [...unique];
  }

  private normalizeCategoryName(value: string): string {
    return value
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('tr-TR');
  }

  private async buildCategoryIdToPathMap(): Promise<Map<string, string>> {
    const categories = await this.prisma.category.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
      },
    });

    const byId = new Map(categories.map((category) => [category.id, category]));
    const result = new Map<string, string>();

    for (const category of categories) {
      const parts: string[] = [];
      const visited = new Set<string>();
      let current:
        | { id: string; name: string; parentId: string | null }
        | undefined = category;

      while (current) {
        if (visited.has(current.id)) break;

        visited.add(current.id);
        parts.unshift(current.name.trim());

        if (parts.length > 3) break;

        current = current.parentId ? byId.get(current.parentId) : undefined;
      }

      if (parts.length > 0 && parts.length <= 3) {
        result.set(category.id, parts.join(' > '));
      }
    }

    return result;
  }

  private async buildCategoryPathMap(): Promise<Map<string, string>> {
    const categories = await this.prisma.category.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
      },
    });

    const byId = new Map(categories.map((category) => [category.id, category]));
    const result = new Map<string, string>();

    for (const category of categories) {
      const parts: string[] = [];
      const visited = new Set<string>();
      let current:
        | { id: string; name: string; parentId: string | null }
        | undefined = category;

      while (current) {
        if (visited.has(current.id)) {
          throw new BadRequestException(
            'Kategori ağacında döngü tespit edildi',
          );
        }

        visited.add(current.id);
        parts.unshift(this.normalizeCategoryName(current.name));

        if (parts.length > 3) {
          break;
        }

        current = current.parentId ? byId.get(current.parentId) : undefined;
      }

      if (parts.length <= 3 && parts.length > 0) {
        result.set(parts.join(' > '), category.id);
      }
    }

    return result;
  }

  private resolveCategoryId(
    categoryPath: string | null,
    categoryMap: Map<string, string>,
  ): string | null {
    if (!categoryPath) return null;

    const parts = categoryPath
      .split('>')
      .map((part) => this.normalizeCategoryName(part))
      .filter(Boolean);

    if (parts.length === 0) return null;

    if (parts.length > 3) {
      throw new BadRequestException(
        'Kategori yolu en fazla 3 seviyeden oluşabilir',
      );
    }

    return categoryMap.get(parts.join(' > ')) ?? null;
  }

  private getHeaderMap(
    worksheet: ExcelJS.Worksheet,
  ): Map<number, keyof NormalizedProductRow> {
    const headerRow = worksheet.getRow(1);
    const result = new Map<number, keyof NormalizedProductRow>();

    headerRow.eachCell((cell, columnNumber) => {
      const normalized = this.normalizeHeader(cell.text);
      const field = this.headerAliases[normalized];

      if (field) {
        result.set(columnNumber, field);
      }
    });

    return result;
  }

  private readonly excelHeaders = [
    'Ürün ID (Değiştirmeyin)',
    'SKU',
    'Ürün Adı',
    'Kategori Yolu',
    'Açıklama',
    'Birim',
    'Fiyat',
    'KDV (%)',
    'Minimum Sipariş',
    'Sipariş Artış Miktarı',
    'Stok',
    'Stok Tipi',
    'Termin (Gün)',
    'Görsel URL\'leri',
    'Ülke',
    'Şehir',
    'Kaynak Dil',
  ];

  private prepareWorksheet(
    worksheet: ExcelJS.Worksheet,
    includeErrorColumn = false,
  ): void {
    const headers = includeErrorColumn
      ? [...this.excelHeaders, 'Hatalar']
      : this.excelHeaders;

    worksheet.addRow(headers);
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = {
      vertical: 'middle',
      horizontal: 'center',
    };

    const widths = [
      30, 20, 34, 42, 48, 16, 16, 12, 18,
      22, 14, 18, 16, 48, 18, 18, 14,
    ];

    headers.forEach((_, index) => {
      worksheet.getColumn(index + 1).width =
        includeErrorColumn && index === headers.length - 1
          ? 48
          : widths[index] ?? 18;
    });
  }

  private excelRowFromNormalized(
    row: NormalizedProductRow,
  ): Array<string | number | null> {
    return [
      row.productId,
      row.sku,
      row.title,
      row.categoryPath,
      row.description,
      row.unitType,
      row.basePrice,
      row.vatRate,
      row.moq,
      row.quantityStep,
      row.stockQuantity,
      row.stockType,
      row.leadTimeDays,
      row.imageUrls.join(' | '),
      row.country,
      row.city,
      row.sourceLanguage,
    ];
  }

  async createTemplateBuffer(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nex Tedarik Pazarı';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Ürünler');
    this.prepareWorksheet(worksheet);

    worksheet.addRow([
      null,
      'ORNEK-001',
      'Örnek Ürün',
      'Ana Sektör > Alt Kategori > Ürün Grubu',
      'Ürün açıklaması',
      'Adet',
      90,
      20,
      10,
      5,
      100,
      'Stokta',
      3,
      'https://example.com/urun-1.jpg | https://example.com/urun-2.jpg',
      'Türkiye',
      'İstanbul',
      'tr',
    ]);

    const info = workbook.addWorksheet('Açıklamalar');
    info.addRows([
      ['Alan', 'Açıklama'],
      ['Ürün ID (Değiştirmeyin)', 'Mevcut ürün dışa aktarımında sistem tarafından doldurulur. Değiştirmeyin. Yeni ürünlerde boş bırakın.'],
      ['SKU', 'Zorunlu ve satıcı hesabınız içinde benzersiz ürün kodu.'],
      ['Ürün Adı', 'Zorunlu.'],
      ['Kategori Yolu', 'En fazla 3 seviye. Örnek: Ana Sektör > Alt Kategori > Ürün Grubu'],
      ['Birim', 'Zorunlu. Örnek: Adet, Koli, Kg.'],
      ['Fiyat', 'Zorunlu birim fiyat. 0 veya daha büyük olmalıdır.'],
      ['KDV (%)', 'Boş bırakılabilir. 0 ile 100 arasında tam sayı.'],
      ['Minimum Sipariş', 'Zorunlu ve en az 1.'],
      ['Sipariş Artış Miktarı', 'Boşsa 1 kabul edilir. Örnek MOQ 10, artış 5 => 10, 15, 20.'],
      ['Görsel URL\'leri', 'Birden fazla adresi | işaretiyle ayırın. İlk geçerli adres kapak görselidir. Geçersiz adresler ürün satırını durdurmadan atlanır.'],
      ['Kaynak Dil', 'Boşsa tr kabul edilir.'],
      ['Güvenlik', 'Excel formülleri içe aktarılmaz. Görsel URL adresleri sunucu tarafından otomatik ziyaret edilmez.'],
    ]);

    info.getRow(1).font = { bold: true };
    info.getColumn(1).width = 24;
    info.getColumn(2).width = 90;
    info.views = [{ state: 'frozen', ySplit: 1 }];

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async createProductExportBuffer(user: ImportUser): Promise<Buffer> {
    const company = await this.requireVerifiedSellerCompany(user);
    const categoryPaths = await this.buildCategoryIdToPathMap();

    const products = await this.prisma.product.findMany({
      where: { sellerId: company.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sku: true,
        title: true,
        description: true,
        categoryId: true,
        sourceLanguage: true,
        country: true,
        city: true,
        unitType: true,
        moq: true,
        quantityStep: true,
        basePrice: true,
        leadTimeDays: true,
        stockType: true,
        stockQuantity: true,
        vatRate: true,
        imageUrl: true,
        images: {
          select: {
            url: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nex Tedarik Pazarı';
    const worksheet = workbook.addWorksheet('Ürünler');
    this.prepareWorksheet(worksheet);

    for (const product of products) {
      const imageUrls =
        product.images.length > 0
          ? product.images.map((image) => image.url)
          : product.imageUrl
            ? [product.imageUrl]
            : [];

      worksheet.addRow(
        this.excelRowFromNormalized({
          productId: product.id,
          sku: product.sku ?? '',
          title: product.title,
          description: product.description,
          categoryId: product.categoryId,
          categoryPath: product.categoryId
            ? categoryPaths.get(product.categoryId) ?? null
            : null,
          sourceLanguage: product.sourceLanguage,
          country: product.country,
          city: product.city,
          unitType: product.unitType,
          moq: product.moq,
          quantityStep: product.quantityStep,
          basePrice: Number(product.basePrice),
          leadTimeDays: product.leadTimeDays,
          stockType: product.stockType,
          stockQuantity: product.stockQuantity,
          vatRate: product.vatRate,
          imageUrlsProvided: imageUrls.length > 0,
          imageUrls,
        }),
      );
    }

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async createErrorExportBuffer(
    user: ImportUser,
    jobId: string,
  ): Promise<Buffer> {
    const company = await this.requireVerifiedSellerCompany(user);

    const job = await this.prisma.productImportJob.findFirst({
      where: {
        id: jobId,
        sellerId: company.id,
      },
      select: {
        id: true,
        originalFileName: true,
      },
    });

    if (!job) {
      throw new NotFoundException('İçe aktarma kaydı bulunamadı');
    }

    const rows = await this.prisma.productImportRow.findMany({
      where: {
        jobId: job.id,
        action: ProductImportRowAction.ERROR,
      },
      orderBy: { rowNumber: 'asc' },
      select: {
        normalized: true,
        errors: true,
      },
    });

    if (rows.length === 0) {
      throw new BadRequestException('Bu içe aktarmada hatalı satır bulunmuyor');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nex Tedarik Pazarı';
    const worksheet = workbook.addWorksheet('Hatalı Ürünler');
    this.prepareWorksheet(worksheet, true);

    for (const row of rows) {
      const normalized = this.normalizedFromJson(row.normalized);
      const errors = Array.isArray(row.errors)
        ? row.errors.map((value) => String(value)).join(' | ')
        : 'Satır doğrulanamadı';

      worksheet.addRow([
        ...this.excelRowFromNormalized(normalized),
        errors,
      ]);
    }

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  async confirmJob(user: ImportUser, jobId: string) {
    const company = await this.requireVerifiedSellerCompany(user);

    const job = await this.prisma.productImportJob.findFirst({
      where: {
        id: jobId,
        sellerId: company.id,
      },
    });

    if (!job) {
      throw new NotFoundException('İçe aktarma kaydı bulunamadı');
    }

    if (
      job.status !== ProductImportStatus.READY &&
      job.status !== ProductImportStatus.IMPORTING
    ) {
      throw new BadRequestException(
        'Bu içe aktarma kaydı işleme hazır değil',
      );
    }

    if (job.status === ProductImportStatus.READY) {
      const now = new Date();

      await this.prisma.$transaction([
        this.prisma.productImportRow.updateMany({
          where: {
            jobId: job.id,
            action: ProductImportRowAction.UNCHANGED,
            processedAt: null,
          },
          data: { processedAt: now },
        }),
        this.prisma.productImportJob.update({
          where: { id: job.id },
          data: {
            status: ProductImportStatus.IMPORTING,
            startedAt: job.startedAt ?? now,
            processedRows: job.unchangedRows,
          },
        }),
      ]);
    }

    return this.getJob(user, job.id);
  }

  private normalizedFromJson(value: Prisma.JsonValue): NormalizedProductRow {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('İçe aktarma satırı geçersiz');
    }

    return value as unknown as NormalizedProductRow;
  }

  private async processImportRow(
    tx: Prisma.TransactionClient,
    sellerId: string,
    row: {
      id: string;
      sku: string | null;
      action: ProductImportRowAction;
      productId: string | null;
      normalized: Prisma.JsonValue | null;
    },
  ): Promise<void> {
    if (
      row.action !== ProductImportRowAction.NEW &&
      row.action !== ProductImportRowAction.UPDATE
    ) {
      return;
    }

    const normalized = this.normalizedFromJson(row.normalized);

    if (!normalized.sku) {
      throw new BadRequestException('SKU bulunamadı');
    }

    const existingById = row.productId
        ? await tx.product.findFirst({
            where: {
              id: row.productId,
              sellerId,
            },
            select: {
              id: true,
              sku: true,
            },
          })
        : null;

      if (row.productId && !existingById) {
        throw new BadRequestException(
          'Ürün bulunamadı veya bu satıcı hesabına ait değil',
        );
      }

      if (
        row.action === ProductImportRowAction.UPDATE &&
        existingById &&
        (existingById.sku ?? '').toUpperCase() !== (row.sku ?? '').toUpperCase()
      ) {
        throw new BadRequestException(
          'Ürünün SKU bilgisi ön kontrolden sonra değişmiş. Excel dosyasını yeniden yükleyin',
        );
      }

      const existingBySku = await tx.product.findUnique({
        where: {
          sellerId_sku: {
            sellerId,
            sku: normalized.sku,
          },
        },
        select: {
          id: true,
          sku: true,
        },
      });

      if (
        existingById &&
        existingBySku &&
        existingById.id !== existingBySku.id
      ) {
        throw new BadRequestException(
          `SKU başka bir ürüne ait: ${normalized.sku}`,
        );
      }

      const existing = existingById ?? existingBySku;
      let productId: string;

      if (existing) {
        const product = await tx.product.update({
          where: { id: existing.id },
          data: {
            sku: normalized.sku,
            categoryId: normalized.categoryId,
            title: normalized.title,
            description: normalized.description,
            sourceLanguage: normalized.sourceLanguage,
            ...(normalized.imageUrlsProvided
              ? { imageUrl: normalized.imageUrls[0] ?? null }
              : {}),
            country: normalized.country,
            city: normalized.city,
            unitType: normalized.unitType,
            moq: normalized.moq,
            quantityStep: normalized.quantityStep,
            basePrice: normalized.basePrice,
            leadTimeDays: normalized.leadTimeDays,
            stockType: normalized.stockType,
            stockQuantity: normalized.stockQuantity,
            vatRate: normalized.vatRate,
          },
          select: { id: true },
        });

        productId = product.id;
      } else {
        if (row.action === ProductImportRowAction.UPDATE) {
          throw new BadRequestException(
            'Güncellenecek ürün artık bulunamıyor',
          );
        }

        const product = await tx.product.create({
          data: {
            sellerId,
            categoryId: normalized.categoryId,
            sku: normalized.sku,
            title: normalized.title,
            description: normalized.description,
            sourceLanguage: normalized.sourceLanguage,
            imageUrl: normalized.imageUrls[0] ?? null,
            country: normalized.country,
            city: normalized.city,
            unitType: normalized.unitType,
            moq: normalized.moq,
            quantityStep: normalized.quantityStep,
            basePrice: normalized.basePrice,
            leadTimeDays: normalized.leadTimeDays,
            stockType: normalized.stockType,
            stockQuantity: normalized.stockQuantity,
            vatRate: normalized.vatRate,
            rfqEnabled: false,
            isActive: true,
            isApproved: true,
          },
          select: { id: true },
        });

        productId = product.id;
      }

      if (!existing || normalized.imageUrlsProvided) {
        await tx.productImage.deleteMany({
          where: { productId },
        });

        if (normalized.imageUrls.length > 0) {
          await tx.productImage.createMany({
            data: normalized.imageUrls.map((url, index) => ({
              productId,
              url,
              sortOrder: index,
              isCover: index === 0,
            })),
          });
        }
      }

    await tx.productImportRow.update({
      where: { id: row.id },
      data: {
        productId,
        processedAt: new Date(),
        processingToken: null,
        processingStartedAt: null,
      },
    });
  }

  async processNextBatch(
    user: ImportUser,
    jobId: string,
    batchSize = 100,
  ) {
    const company = await this.requireVerifiedSellerCompany(user);

    const job = await this.prisma.productImportJob.findFirst({
      where: {
        id: jobId,
        sellerId: company.id,
      },
    });

    if (!job) {
      throw new NotFoundException('İçe aktarma kaydı bulunamadı');
    }

    if (job.status !== ProductImportStatus.IMPORTING) {
      throw new BadRequestException(
        'İçe aktarma önce satıcı tarafından onaylanmalıdır',
      );
    }

    const safeBatchSize =
      Number.isInteger(batchSize) && batchSize > 0
        ? Math.min(batchSize, 200)
        : 100;

    const processingToken = randomUUID();
    const staleBefore = new Date(Date.now() - 60 * 60 * 1000);

    const rows = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${'product-import:' + job.id}, 0)
        )::text
      `;

      await tx.productImportRow.updateMany({
        where: {
          jobId: job.id,
          processedAt: null,
          processingStartedAt: {
            lt: staleBefore,
          },
        },
        data: {
          processingToken: null,
          processingStartedAt: null,
        },
      });

      const claimedRows = await tx.productImportRow.findMany({
        where: {
          jobId: job.id,
          processedAt: null,
          processingToken: null,
          action: {
            in: [
              ProductImportRowAction.NEW,
              ProductImportRowAction.UPDATE,
            ],
          },
        },
        orderBy: { rowNumber: 'asc' },
        take: safeBatchSize,
        select: {
          id: true,
          sku: true,
          action: true,
          productId: true,
          normalized: true,
        },
      });

      if (claimedRows.length > 0) {
        await tx.productImportRow.updateMany({
          where: {
            id: {
              in: claimedRows.map((row) => row.id),
            },
            processedAt: null,
            processingToken: null,
          },
          data: {
            processingToken,
            processingStartedAt: new Date(),
          },
        });
      }

      return claimedRows;
    });

    for (const row of rows) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const claimedRow = await tx.productImportRow.findFirst({
            where: {
              id: row.id,
              jobId: job.id,
              processedAt: null,
              processingToken,
            },
            select: {
              id: true,
              sku: true,
              action: true,
              productId: true,
              normalized: true,
            },
          });

          if (!claimedRow) {
            return;
          }

          await this.processImportRow(tx, company.id, claimedRow);
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Ürün işlenemedi';

        await this.prisma.productImportRow.updateMany({
          where: {
            id: row.id,
            jobId: job.id,
            processedAt: null,
            processingToken,
          },
          data: {
            action: ProductImportRowAction.ERROR,
            errors: [message],
            processedAt: new Date(),
            processingToken: null,
            processingStartedAt: null,
          },
        });
      }
    }

    const [
      errorRows,
      newRows,
      updateRows,
      unchangedRows,
      processedRows,
      remainingRows,
    ] = await this.prisma.$transaction([
      this.prisma.productImportRow.count({
        where: {
          jobId: job.id,
          action: ProductImportRowAction.ERROR,
        },
      }),
      this.prisma.productImportRow.count({
        where: {
          jobId: job.id,
          action: ProductImportRowAction.NEW,
        },
      }),
      this.prisma.productImportRow.count({
        where: {
          jobId: job.id,
          action: ProductImportRowAction.UPDATE,
        },
      }),
      this.prisma.productImportRow.count({
        where: {
          jobId: job.id,
          action: ProductImportRowAction.UNCHANGED,
        },
      }),
      this.prisma.productImportRow.count({
        where: {
          jobId: job.id,
          processedAt: { not: null },
          action: {
            in: [
              ProductImportRowAction.NEW,
              ProductImportRowAction.UPDATE,
              ProductImportRowAction.UNCHANGED,
            ],
          },
        },
      }),
      this.prisma.productImportRow.count({
        where: {
          jobId: job.id,
          processedAt: null,
          action: {
            in: [
              ProductImportRowAction.NEW,
              ProductImportRowAction.UPDATE,
            ],
          },
        },
      }),
    ]);

    const completed = remainingRows === 0;

    await this.prisma.productImportJob.update({
      where: { id: job.id },
      data: {
        errorRows,
        newRows,
        updateRows,
        unchangedRows,
        readyRows: job.totalRows - errorRows,
        processedRows,
        ...(completed
          ? {
              status: ProductImportStatus.COMPLETED,
              completedAt: new Date(),
            }
          : {}),
      },
    });

    return {
      ...(await this.getJob(user, job.id)),
      batchProcessed: rows.length,
      remainingRows,
    };
  }

  async getJob(user: ImportUser, jobId: string) {
    const company = await this.requireVerifiedSellerCompany(user);

    const job = await this.prisma.productImportJob.findFirst({
      where: {
        id: jobId,
        sellerId: company.id,
      },
      select: {
        id: true,
        source: true,
        status: true,
        originalFileName: true,
        totalRows: true,
        readyRows: true,
        errorRows: true,
        newRows: true,
        updateRows: true,
        unchangedRows: true,
        processedRows: true,
        startedAt: true,
        completedAt: true,
        failedAt: true,
        failureMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!job) {
      throw new NotFoundException('İçe aktarma kaydı bulunamadı');
    }

    return job;
  }

  async getJobRows(
    user: ImportUser,
    jobId: string,
    page = 1,
    limit = 50,
    action?: ProductImportRowAction,
  ) {
    const company = await this.requireVerifiedSellerCompany(user);

    const job = await this.prisma.productImportJob.findFirst({
      where: {
        id: jobId,
        sellerId: company.id,
      },
      select: { id: true },
    });

    if (!job) {
      throw new NotFoundException('İçe aktarma kaydı bulunamadı');
    }

    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safeLimit =
      Number.isInteger(limit) && limit > 0
        ? Math.min(limit, 100)
        : 50;

    const where: Prisma.ProductImportRowWhereInput = {
      jobId: job.id,
      ...(action ? { action } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.productImportRow.count({ where }),
      this.prisma.productImportRow.findMany({
        where,
        orderBy: { rowNumber: 'asc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: {
          id: true,
          rowNumber: true,
          sku: true,
          action: true,
          productId: true,
          rawData: true,
          errors: true,
          normalized: true,
          processedAt: true,
        },
      }),
    ]);

    return {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
      rows,
    };
  }

  async createExcelJob(
    user: ImportUser,
    file: { originalname?: string; buffer?: Buffer },
  ) {
    const company = await this.requireVerifiedSellerCompany(user);

    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Excel dosyası bulunamadı');
    }

    if (file.buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Excel dosyası en fazla 10 MB olabilir');
    }

    const fileName = file.originalname?.trim() || 'urunler.xlsx';

    if (!fileName.toLocaleLowerCase('tr-TR').endsWith('.xlsx')) {
      throw new BadRequestException('Yalnızca .xlsx dosyaları kabul edilir');
    }

    const workbook = new ExcelJS.Workbook();

    try {
      await workbook.xlsx.load(
        file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
    } catch {
      throw new BadRequestException('Excel dosyası okunamadı veya bozuk');
    }

    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new BadRequestException('Excel dosyasında çalışma sayfası bulunamadı');
    }

    const headerMap = this.getHeaderMap(worksheet);

    const requiredFields: Array<keyof NormalizedProductRow> = [
      'sku',
      'title',
      'unitType',
      'moq',
      'basePrice',
    ];

    const mappedFields = new Set(headerMap.values());
    const missingFields = requiredFields.filter(
      (field) => !mappedFields.has(field),
    );

    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Excel başlıkları eksik: ${missingFields.join(', ')}`,
      );
    }

    const rawRows = this.readExcelRows(worksheet, headerMap);

    if (rawRows.length === 0) {
      throw new BadRequestException('Excel dosyasında ürün satırı bulunamadı');
    }

    if (rawRows.length > 10000) {
      throw new BadRequestException(
        'Tek Excel dosyasında en fazla 10.000 ürün işlenebilir',
      );
    }

    const categoryMap = await this.buildCategoryPathMap();

    const normalizedRows = rawRows.map((row) => {
      const result = this.normalizeImportedRow(row.raw, categoryMap);

      return {
        rowNumber: row.rowNumber,
        raw: row.raw,
        normalized: result.normalized,
        errors: result.errors,
      };
    });

    const classifiedRows = await this.classifyRows(
      company.id,
      normalizedRows,
    );

    const counts = {
      totalRows: classifiedRows.length,
      errorRows: classifiedRows.filter(
        (row) => row.action === ProductImportRowAction.ERROR,
      ).length,
      newRows: classifiedRows.filter(
        (row) => row.action === ProductImportRowAction.NEW,
      ).length,
      updateRows: classifiedRows.filter(
        (row) => row.action === ProductImportRowAction.UPDATE,
      ).length,
      unchangedRows: classifiedRows.filter(
        (row) => row.action === ProductImportRowAction.UNCHANGED,
      ).length,
    };

    const readyRows = counts.totalRows - counts.errorRows;
    const status =
      readyRows > 0
        ? ProductImportStatus.READY
        : ProductImportStatus.VALIDATED;

    const job = await this.prisma.productImportJob.create({
      data: {
        sellerId: company.id,
        source: ProductImportSource.EXCEL,
        status,
        originalFileName: fileName,
        totalRows: counts.totalRows,
        readyRows,
        errorRows: counts.errorRows,
        newRows: counts.newRows,
        updateRows: counts.updateRows,
        unchangedRows: counts.unchangedRows,
      },
      select: {
        id: true,
        source: true,
        status: true,
        originalFileName: true,
        totalRows: true,
        readyRows: true,
        errorRows: true,
        newRows: true,
        updateRows: true,
        unchangedRows: true,
        processedRows: true,
        createdAt: true,
      },
    });

    try {
      const chunkSize = 500;

      for (let index = 0; index < classifiedRows.length; index += chunkSize) {
        const chunk = classifiedRows.slice(index, index + chunkSize);

        await this.prisma.productImportRow.createMany({
          data: chunk.map((row) => ({
            jobId: job.id,
            rowNumber: row.rowNumber,
            sku: row.sku,
            action: row.action,
            productId: row.productId,
            rawData: row.rawData,
            errors: row.errors,
            normalized: row.normalized,
          })),
        });
      }
    } catch (error) {
      await this.prisma.productImportJob.update({
        where: { id: job.id },
        data: {
          status: ProductImportStatus.FAILED,
          failedAt: new Date(),
          failureMessage: 'İçe aktarma ön kontrol satırları kaydedilemedi',
        },
      });

      throw error;
    }

    return job;
  }

  private sameNullableText(
    left: string | null | undefined,
    right: string | null | undefined,
  ): boolean {
    return (left ?? null) === (right ?? null);
  }

  private productMatchesNormalized(
    product: {
      sku: string | null;
      categoryId: string | null;
      title: string;
      description: string | null;
      sourceLanguage: string;
      imageUrl: string | null;
      country: string | null;
      city: string | null;
      unitType: string;
      moq: number;
      quantityStep: number;
      basePrice: Prisma.Decimal;
      leadTimeDays: number | null;
      stockType: string | null;
      stockQuantity: number | null;
      vatRate: number | null;
      images: Array<{
        url: string;
        sortOrder: number;
        isCover: boolean;
      }>;
    },
    normalized: NormalizedProductRow,
  ): boolean {
    const existingImages = product.images
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => image.url);

    const expectedImages = normalized.imageUrls;

    const imagesMatch =
      !normalized.imageUrlsProvided ||
      (existingImages.length === expectedImages.length &&
        existingImages.every((url, index) => url === expectedImages[index]));

    return (
      (product.sku ?? '') === normalized.sku &&
      product.categoryId === normalized.categoryId &&
      product.title === normalized.title &&
      this.sameNullableText(product.description, normalized.description) &&
      product.sourceLanguage === normalized.sourceLanguage &&
      this.sameNullableText(product.country, normalized.country) &&
      this.sameNullableText(product.city, normalized.city) &&
      product.unitType === normalized.unitType &&
      product.moq === normalized.moq &&
      product.quantityStep === normalized.quantityStep &&
      Number(product.basePrice) === normalized.basePrice &&
      product.leadTimeDays === normalized.leadTimeDays &&
      this.sameNullableText(product.stockType, normalized.stockType) &&
      product.stockQuantity === normalized.stockQuantity &&
      product.vatRate === normalized.vatRate &&
      (!normalized.imageUrlsProvided ||
        (product.imageUrl ?? null) === (expectedImages[0] ?? null)) &&
      imagesMatch
    );
  }

  private async classifyRows(
    sellerId: string,
    rows: Array<{
      rowNumber: number;
      raw: Record<string, unknown>;
      normalized: NormalizedProductRow;
      errors: string[];
    }>,
  ): Promise<
    Array<{
      rowNumber: number;
      sku: string | null;
      action: ProductImportRowAction;
      productId: string | null;
      rawData: Prisma.InputJsonValue;
      errors: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      normalized: Prisma.InputJsonValue;
    }>
  > {
    const skuCounts = new Map<string, number>();

    for (const row of rows) {
      if (!row.normalized.sku) continue;
      const key = row.normalized.sku;
      skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
    }

    const uniqueSkus = [
      ...new Set(
        rows
          .map((row) => row.normalized.sku)
          .filter((sku): sku is string => Boolean(sku)),
      ),
    ];

    const uniqueProductIds = [
      ...new Set(
        rows
          .map((row) => row.normalized.productId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const existingProducts =
      uniqueSkus.length === 0 && uniqueProductIds.length === 0
        ? []
        : await this.prisma.product.findMany({
            where: {
              sellerId,
              OR: [
                ...(uniqueSkus.length > 0
                  ? [{ sku: { in: uniqueSkus } }]
                  : []),
                ...(uniqueProductIds.length > 0
                  ? [{ id: { in: uniqueProductIds } }]
                  : []),
              ],
            },
            select: {
              id: true,
              sku: true,
              categoryId: true,
              title: true,
              description: true,
              sourceLanguage: true,
              imageUrl: true,
              country: true,
              city: true,
              unitType: true,
              moq: true,
              quantityStep: true,
              basePrice: true,
              leadTimeDays: true,
              stockType: true,
              stockQuantity: true,
              vatRate: true,
              images: {
                select: {
                  url: true,
                  sortOrder: true,
                  isCover: true,
                },
                orderBy: { sortOrder: 'asc' },
              },
            },
          });

    const existingById = new Map(
      existingProducts.map((product) => [product.id, product]),
    );

    const existingBySku = new Map(
      existingProducts
        .filter((product) => product.sku)
        .map((product) => [
          product.sku!.toUpperCase(),
          product,
        ]),
    );

    return rows.map((row) => {
      const errors = [...row.errors];
      const skuKey = row.normalized.sku;

      if (skuKey && (skuCounts.get(skuKey) ?? 0) > 1) {
        errors.push(`Excel içinde mükerrer SKU: ${row.normalized.sku}`);
      }

      const byId = row.normalized.productId
        ? existingById.get(row.normalized.productId)
        : undefined;
      const bySku = skuKey ? existingBySku.get(skuKey) : undefined;

      if (row.normalized.productId && !byId) {
        errors.push(
          'Ürün ID bulunamadı veya bu satıcı hesabına ait değil',
        );
      }

      if (byId && bySku && byId.id !== bySku.id) {
        errors.push(
          `Ürün ID ile SKU farklı ürünlere ait: ${row.normalized.sku}`,
        );
      }

      const existing = byId ?? bySku;

      let action: ProductImportRowAction;

      if (errors.length > 0) {
        action = ProductImportRowAction.ERROR;
      } else if (!existing) {
        action = ProductImportRowAction.NEW;
      } else if (this.productMatchesNormalized(existing, row.normalized)) {
        action = ProductImportRowAction.UNCHANGED;
      } else {
        action = ProductImportRowAction.UPDATE;
      }

      return {
        rowNumber: row.rowNumber,
        sku: row.normalized.sku || null,
        action,
        productId: existing?.id ?? null,
        rawData: row.raw as Prisma.InputJsonValue,
        errors:
          errors.length > 0
            ? (errors as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        normalized: row.normalized as unknown as Prisma.InputJsonValue,
      };
    });
  }

  private readExcelRows(
    worksheet: ExcelJS.Worksheet,
    headerMap: Map<number, keyof NormalizedProductRow>,
  ): Array<{ rowNumber: number; raw: Record<string, unknown> }> {
    const rows: Array<{ rowNumber: number; raw: Record<string, unknown> }> = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const raw: Record<string, unknown> = {};
      let hasValue = false;

      for (const [columnNumber, field] of headerMap.entries()) {
        const cell = row.getCell(columnNumber);

        if (
          cell.value &&
          typeof cell.value === 'object' &&
          'formula' in cell.value
        ) {
          raw[field] = '__FORMULA_NOT_ALLOWED__';
          hasValue = true;
          continue;
        }

        const value = cell.text.trim();

        if (value !== '') {
          hasValue = true;
        }

        raw[field] = value;
      }

      if (hasValue) {
        rows.push({ rowNumber, raw });
      }
    }

    return rows;
  }

  private normalizeImportedRow(
    raw: Record<string, unknown>,
    categoryMap: Map<string, string>,
  ): { normalized: NormalizedProductRow; errors: string[] } {
    const errors: string[] = [];

    for (const [field, value] of Object.entries(raw)) {
      if (value === '__FORMULA_NOT_ALLOWED__') {
        errors.push(`${field} alanında Excel formülü kullanılamaz`);
      }
    }

    const sku = this.text(raw.sku).toUpperCase();
    const title = this.text(raw.title);
    const unitType = this.text(raw.unitType);
    const categoryPath = this.nullableText(raw.categoryPath);

    const moq = this.integer(raw.moq);
    const quantityStep =
      this.text(raw.quantityStep) === '' ? 1 : this.integer(raw.quantityStep);
    const basePrice = this.decimal(raw.basePrice);

    const leadTimeDays =
      this.text(raw.leadTimeDays) === ''
        ? null
        : this.integer(raw.leadTimeDays);

    const stockQuantity =
      this.text(raw.stockQuantity) === ''
        ? null
        : this.integer(raw.stockQuantity);

    const vatRate =
      this.text(raw.vatRate) === '' ? null : this.integer(raw.vatRate);

    if (!sku) errors.push('SKU zorunludur');
    if (!title) errors.push('Ürün adı zorunludur');
    if (!unitType) errors.push('Birim zorunludur');

    if (moq === null || moq < 1) {
      errors.push('Minimum sipariş miktarı en az 1 olmalıdır');
    }

    if (quantityStep === null || quantityStep < 1) {
      errors.push('Sipariş artış miktarı en az 1 olmalıdır');
    }

    if (basePrice === null || basePrice < 0) {
      errors.push('Fiyat 0 veya daha büyük geçerli bir sayı olmalıdır');
    }

    if (leadTimeDays !== null && leadTimeDays < 0) {
      errors.push('Termin günü negatif olamaz');
    }

    if (stockQuantity !== null && stockQuantity < 0) {
      errors.push('Stok miktarı negatif olamaz');
    }

    if (vatRate !== null && (vatRate < 0 || vatRate > 100)) {
      errors.push('KDV oranı 0 ile 100 arasında olmalıdır');
    }

    let categoryId: string | null = null;

    if (categoryPath) {
      const categoryParts = categoryPath
        .split('>')
        .map((part) => part.trim())
        .filter(Boolean);

      if (categoryParts.length > 3) {
        errors.push('Kategori yolu en fazla 3 seviyeden oluşabilir');
      } else {
        categoryId = this.resolveCategoryId(categoryPath, categoryMap);

        if (!categoryId) {
          errors.push(`Kategori yolu bulunamadı: ${categoryPath}`);
        }
      }
    }

    const imageUrls = this.parseImageUrls(raw.imageUrls);
    const imageUrlsProvided = imageUrls.length > 0;

    return {
      normalized: {
        productId: this.nullableText(raw.productId),
        sku,
        title,
        description: this.nullableText(raw.description),
        categoryId,
        categoryPath,
        sourceLanguage: this.text(raw.sourceLanguage) || 'tr',
        country: this.nullableText(raw.country),
        city: this.nullableText(raw.city),
        unitType,
        moq: moq ?? 1,
        quantityStep: quantityStep ?? 1,
        basePrice: basePrice ?? 0,
        leadTimeDays,
        stockType: this.nullableText(raw.stockType),
        stockQuantity,
        vatRate,
        imageUrlsProvided,
        imageUrls,
      },
      errors,
    };
  }

  private normalizeHeader(value: unknown): string {
    return this.text(value)
      .toLocaleLowerCase('tr-TR')
      .replace(/[ıİ]/g, 'i')
      .replace(/[şŞ]/g, 's')
      .replace(/[ğĞ]/g, 'g')
      .replace(/[üÜ]/g, 'u')
      .replace(/[öÖ]/g, 'o')
      .replace(/[çÇ]/g, 'c')
      .replace(/[^a-z0-9]+/g, '');
  }
}
