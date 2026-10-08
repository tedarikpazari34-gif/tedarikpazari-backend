import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CompanyStatus,
  Prisma,
  ProductAttributeType,
  ProductImportRowAction,
  ProductImportSource,
  ProductImportStatus,
  Role,
} from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma.service';
import { ProductCatalogService } from './product-catalog.service';
import {
  ProductAttributeValueDto,
  ProductVariantDto,
} from './dto/create-product.dto';

type ImportUser = {
  role: Role;
  companyId: string;
};

type RawImportVariant = {
  parentSku: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  manufacturerCode: string | null;
  price: number | null;
  stockQuantity: number | null;
  isActive: boolean;
  sortOrder: number;
};

type RawImportAttributeValue = {
  parentSku: string;
  attributeCode: string;
  value: string;
};

type VariantExcelField =
  | 'parentSku'
  | 'name'
  | 'sku'
  | 'barcode'
  | 'manufacturerCode'
  | 'price'
  | 'stockQuantity'
  | 'isActive'
  | 'sortOrder';

type AttributeExcelField =
  | 'parentSku'
  | 'attributeCode'
  | 'value';

type ImportRelatedRows = {
  variants?: Array<{
    rowNumber: number;
    raw: Record<VariantExcelField, unknown>;
  }>;
  attributes?: Array<{
    rowNumber: number;
    raw: Record<AttributeExcelField, unknown>;
  }>;
};

type NormalizedImportVariant = {
  name: string;
  sku: string | null;
  barcode: string | null;
  manufacturerCode: string | null;
  price: number | null;
  stockQuantity: number | null;
  isActive: boolean;
  sortOrder: number;
};

type NormalizedImportAttributeValue = {
  attributeId: string;
  textValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  optionCodes: string[];
};

type NormalizedProductRow = {
  productId: string | null;
  sku: string;
  brand: string | null;
  barcode: string | null;
  manufacturerCode: string | null;
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
  variantsProvided: boolean;
  variants: NormalizedImportVariant[];
  attributeValuesProvided: boolean;
  attributeValues: NormalizedImportAttributeValue[];
};

@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: ProductCatalogService,
  ) {}

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

    marka: 'brand',
    brand: 'brand',

    barkod: 'barcode',
    gtin: 'barcode',
    barcode: 'barcode',

    ureticikodu: 'manufacturerCode',
    modelkodu: 'manufacturerCode',
    manufacturercode: 'manufacturerCode',

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
    title: 'title',
    description: 'description',
    categorypath: 'categoryPath',
    unittype: 'unitType',
    baseprice: 'basePrice',
    vatrate: 'vatRate',
    stockquantity: 'stockQuantity',
    stocktype: 'stockType',
    leadtimedays: 'leadTimeDays',
    imageurls: 'imageUrls',
    country: 'country',
    city: 'city',
    sourcelanguage: 'sourceLanguage',
  };

  private readonly variantHeaderAliases: Record<string, VariantExcelField> = {
    anaurunsku: 'parentSku',
    parentsku: 'parentSku',
    varyantadi: 'name',
    variantname: 'name',
    varyantsku: 'sku',
    variantsku: 'sku',
    barkod: 'barcode',
    gtin: 'barcode',
    barcode: 'barcode',
    ureticikodu: 'manufacturerCode',
    modelkodu: 'manufacturerCode',
    manufacturercode: 'manufacturerCode',
    fiyat: 'price',
    price: 'price',
    stok: 'stockQuantity',
    stokmiktari: 'stockQuantity',
    stockquantity: 'stockQuantity',
    aktif: 'isActive',
    active: 'isActive',
    isactive: 'isActive',
    sira: 'sortOrder',
    sortorder: 'sortOrder',
  };

  private readonly attributeHeaderAliases: Record<string, AttributeExcelField> = {
    anaurunsku: 'parentSku',
    parentsku: 'parentSku',
    ozellikkodu: 'attributeCode',
    attributecode: 'attributeCode',
    deger: 'value',
    value: 'value',
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
    'Marka',
    'Barkod / GTIN',
    'Üretici / Model Kodu',
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

  private readonly variantExcelHeaders = [
    'Ana Ürün SKU',
    'Varyant Adı',
    'Varyant SKU',
    'Barkod / GTIN',
    'Üretici / Model Kodu',
    'Fiyat',
    'Stok',
    'Aktif',
    'Sıra',
  ];

  private readonly attributeExcelHeaders = [
    'Ana Ürün SKU',
    'Özellik Kodu',
    'Değer',
  ];

  private prepareRelatedWorksheet(
    worksheet: ExcelJS.Worksheet,
    headers: string[],
    widths: number[],
  ): void {
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

    headers.forEach((_, index) => {
      worksheet.getColumn(index + 1).width = widths[index] ?? 18;
    });
  }

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
      30, 20, 24, 20, 24, 34, 42, 48, 16, 16,
      12, 18, 22, 14, 18, 16, 48, 18, 18, 14,
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
      row.brand,
      row.barcode,
      row.manufacturerCode,
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
      'Örnek Marka',
      '8690000000001',
      'MODEL-001',
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

    const variantsWorksheet = workbook.addWorksheet('Varyantlar');
    this.prepareRelatedWorksheet(
      variantsWorksheet,
      this.variantExcelHeaders,
      [20, 28, 20, 20, 24, 16, 14, 12, 10],
    );
    variantsWorksheet.addRow([
      'ORNEK-001',
      'Kırmızı / L',
      'ORNEK-001-KRM-L',
      '8690000000002',
      'MODEL-001-KRM-L',
      95,
      25,
      'Evet',
      0,
    ]);

    const attributesWorksheet = workbook.addWorksheet('Özellikler');
    this.prepareRelatedWorksheet(
      attributesWorksheet,
      this.attributeExcelHeaders,
      [20, 24, 48],
    );
    attributesWorksheet.addRow([
      'ORNEK-001',
      'renk',
      'kirmizi',
    ]);
    attributesWorksheet.addRow([
      'ORNEK-001',
      'beden',
      'l',
    ]);

    const info = workbook.addWorksheet('Açıklamalar');
    info.addRows([
      ['Alan', 'Açıklama'],
      ['Ürün ID (Değiştirmeyin)', 'Mevcut ürün dışa aktarımında sistem tarafından doldurulur. Değiştirmeyin. Yeni ürünlerde boş bırakın.'],
      ['SKU', 'Zorunlu ve satıcı hesabınız içinde benzersiz ürün kodu.'],
      ['Marka', 'Opsiyonel. Sistemde tanımlı ortak marka adı kullanılacaktır.'],
      ['Barkod / GTIN', 'Opsiyonel. Ürünün barkod veya GTIN kodu.'],
      ['Üretici / Model Kodu', 'Opsiyonel. Üretici parça, model veya katalog kodu.'],
      ['Ürün Adı', 'Zorunlu.'],
      ['Kategori Yolu', 'En fazla 3 seviye. Örnek: Ana Sektör > Alt Kategori > Ürün Grubu'],
      ['Birim', 'Zorunlu. Örnek: Adet, Koli, Kg.'],
      ['Fiyat', 'Zorunlu birim fiyat. 0 veya daha büyük olmalıdır.'],
      ['KDV (%)', 'Boş bırakılabilir. 0 ile 100 arasında tam sayı.'],
      ['Minimum Sipariş', 'Zorunlu ve en az 1.'],
      ['Sipariş Artış Miktarı', 'Boşsa 1 kabul edilir. Örnek MOQ 10, artış 5 => 10, 15, 20.'],
      ['Görsel URL\'leri', 'Birden fazla adresi | işaretiyle ayırın. İlk geçerli adres kapak görselidir. Geçersiz adresler ürün satırını durdurmadan atlanır.'],
      ['Kaynak Dil', 'Boşsa tr kabul edilir.'],
      ['Varyantlar Sayfası', 'Opsiyonel. Ana Ürün SKU ile Ürünler sayfasındaki ürüne bağlanır. Aynı ürün için birden fazla varyant satırı eklenebilir.'],
      ['Varyant Aktif', 'Evet/Hayır veya true/false kullanılabilir. Boşsa aktif kabul edilir.'],
      ['Özellikler Sayfası', 'Opsiyonel. Ana Ürün SKU ve kategoriye tanımlı Özellik Kodu kullanılır. Aynı ürün için birden fazla özellik satırı eklenebilir.'],
      ['Özellik Değeri', 'Metin/sayı/evet-hayır veya seçenek kodu kullanılır. Çoklu seçimlerde seçenek kodlarını | ile ayırın.'],
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
        barcode: true,
        manufacturerCode: true,
        brand: {
          select: {
            name: true,
          },
        },
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
        variants: {
          select: {
            name: true,
            sku: true,
            barcode: true,
            manufacturerCode: true,
            price: true,
            stockQuantity: true,
            isActive: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
        attributeValues: {
          select: {
            textValue: true,
            numberValue: true,
            booleanValue: true,
            optionCodes: true,
            attribute: {
              select: { code: true },
            },
          },
        },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nex Tedarik Pazarı';
    const worksheet = workbook.addWorksheet('Ürünler');
    this.prepareWorksheet(worksheet);

    const variantsWorksheet = workbook.addWorksheet('Varyantlar');
    this.prepareRelatedWorksheet(
      variantsWorksheet,
      this.variantExcelHeaders,
      [20, 28, 20, 20, 24, 16, 14, 12, 10],
    );

    const attributesWorksheet = workbook.addWorksheet('Özellikler');
    this.prepareRelatedWorksheet(
      attributesWorksheet,
      this.attributeExcelHeaders,
      [20, 24, 48],
    );

    for (const product of products) {
      if (
        !product.sku?.trim() &&
        (product.variants.length > 0 || product.attributeValues.length > 0)
      ) {
        throw new BadRequestException(
          'Varyant veya özellik içeren ürünün SKU bilgisi eksik. Excel dışa aktarımı için önce ürün SKU bilgisini tamamlayın.',
        );
      }
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
          brand: product.brand?.name ?? null,
          barcode: product.barcode,
          manufacturerCode: product.manufacturerCode,
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
          variantsProvided: false,
          variants: [],
          attributeValuesProvided: false,
          attributeValues: [],
        }),
      );

      for (const variant of product.variants) {
        variantsWorksheet.addRow([
          product.sku,
          variant.name,
          variant.sku,
          variant.barcode,
          variant.manufacturerCode,
          variant.price === null ? null : Number(variant.price),
          variant.stockQuantity,
          variant.isActive ? 'Evet' : 'Hayır',
          variant.sortOrder,
        ]);
      }

      for (const value of product.attributeValues) {
        const serializedValue =
          value.optionCodes.length > 0
            ? value.optionCodes.join(' | ')
            : value.booleanValue !== null
              ? value.booleanValue ? 'Evet' : 'Hayır'
              : value.numberValue !== null
                ? Number(value.numberValue)
                : value.textValue ?? '';

        attributesWorksheet.addRow([
          product.sku,
          value.attribute.code,
          serializedValue,
        ]);
      }
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

    const normalized = value as unknown as Partial<NormalizedProductRow>;

    return {
      ...normalized,
      brand: normalized.brand ?? null,
      barcode: normalized.barcode ?? null,
      manufacturerCode: normalized.manufacturerCode ?? null,
      variantsProvided: normalized.variantsProvided ?? false,
      variants: normalized.variants ?? [],
      attributeValuesProvided: normalized.attributeValuesProvided ?? false,
      attributeValues: normalized.attributeValues ?? [],
    } as NormalizedProductRow;
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
              categoryId: true,
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
          'Ürünün SKU bilgisi ön kontrolden sonra değişmiş. İçe aktarma verisini yeniden yükleyin',
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
          categoryId: true,
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

      if (row.action === ProductImportRowAction.UPDATE) {
        if (!row.productId || !existingById) {
          throw new BadRequestException(
            'Güncellenecek ürün kimliği doğrulanamadı. İçe aktarma verisini yeniden yükleyin',
          );
        }

        if (
          (existingById.sku ?? '').toUpperCase() !==
          normalized.sku.toUpperCase()
        ) {
          throw new BadRequestException(
            'Ürün SKU bilgisi ön kontrolden sonra değişmiş. İçe aktarma verisini yeniden yükleyin',
          );
        }
      }

      if (row.action === ProductImportRowAction.NEW && existing) {
        throw new BadRequestException(
          'Yeni ürün SKU bilgisi artık mevcut. İçe aktarma verisini yeniden yükleyin',
        );
      }

      if (row.action === ProductImportRowAction.UPDATE && !existing) {
        throw new BadRequestException(
          'Güncellenecek ürün artık bulunamıyor',
        );
      }

      if (
        existing &&
        existing.categoryId !== normalized.categoryId &&
        !normalized.attributeValuesProvided
      ) {
        throw new BadRequestException(
          'Ürün kategorisi değiştirildiğinde Özellikler verisi de sağlanmalıdır',
        );
      }

      const brandId = await this.catalogService.resolveBrandByName(
        tx,
        normalized.brand,
      );
      let productId: string;

      if (existing) {
        const product = await tx.product.update({
          where: { id: existing.id },
          data: {
            sku: normalized.sku,
            brandId,
            barcode: normalized.barcode,
            manufacturerCode: normalized.manufacturerCode,
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
            brandId,
            barcode: normalized.barcode,
            manufacturerCode: normalized.manufacturerCode,
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

    if (normalized.variantsProvided) {
      await tx.productVariant.deleteMany({
        where: { productId },
      });

      if (normalized.variants.length > 0) {
        await tx.productVariant.createMany({
          data: normalized.variants.map((variant) => ({
            productId,
            name: variant.name,
            sku: variant.sku,
            barcode: variant.barcode,
            manufacturerCode: variant.manufacturerCode,
            price: variant.price,
            stockQuantity: variant.stockQuantity,
            isActive: variant.isActive,
            sortOrder: variant.sortOrder,
          })),
        });
      }
    }

    if (
      normalized.attributeValuesProvided ||
      (existing && existing.categoryId !== normalized.categoryId)
    ) {
      await tx.productAttributeValue.deleteMany({
        where: { productId },
      });

      if (normalized.attributeValues.length > 0) {
        await tx.productAttributeValue.createMany({
          data: normalized.attributeValues.map((value) => ({
            productId,
            attributeId: value.attributeId,
            textValue: value.textValue,
            numberValue: value.numberValue,
            booleanValue: value.booleanValue,
            optionCodes: value.optionCodes,
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

  async createXmlJob(
    user: ImportUser,
    file: { originalname?: string; buffer?: Buffer },
  ) {
    const company = await this.requireVerifiedSellerCompany(user);

    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('XML dosyası bulunamadı');
    }

    if (file.buffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException('XML dosyası en fazla 10 MB olabilir');
    }

    const fileName = file.originalname?.trim() || 'urunler.xml';

    if (!fileName.toLocaleLowerCase('tr-TR').endsWith('.xml')) {
      throw new BadRequestException('Yalnızca .xml dosyaları kabul edilir');
    }

    const xml = file.buffer.toString('utf8').replace(/^\uFEFF/, '');

    if (!xml.trim()) {
      throw new BadRequestException('XML dosyası boş');
    }

    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
      throw new BadRequestException(
        'XML dosyasında DOCTYPE veya ENTITY kullanımına izin verilmez',
      );
    }

    const validation = XMLValidator.validate(xml);

    if (validation !== true) {
      throw new BadRequestException('XML dosyası geçerli değil veya bozuk');
    }

    const parser = new XMLParser({
      ignoreAttributes: true,
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      processEntities: false,
      maxNestedTags: 20,
    });

    let parsed: unknown;

    try {
      parsed = parser.parse(xml);
    } catch {
      throw new BadRequestException('XML dosyası okunamadı veya bozuk');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('XML kök yapısı geçerli değil');
    }

    const rootEntries = Object.entries(parsed as Record<string, unknown>).filter(
      ([key]) => !key.startsWith('?'),
    );

    if (rootEntries.length !== 1) {
      throw new BadRequestException(
        'XML dosyasında tek bir products kök düğümü bulunmalıdır',
      );
    }

    const [rootName, rootValue] = rootEntries[0];

    if (this.normalizeHeader(rootName) !== 'products') {
      throw new BadRequestException('XML kök düğümü products olmalıdır');
    }

    if (!rootValue || typeof rootValue !== 'object' || Array.isArray(rootValue)) {
      throw new BadRequestException('XML products yapısı geçerli değil');
    }

    const productsObject = rootValue as Record<string, unknown>;
    const productEntries = Object.entries(productsObject).filter(
      ([key]) => this.normalizeHeader(key) === 'product',
    );
    const unexpectedRootFields = Object.keys(productsObject).filter(
      (key) => this.normalizeHeader(key) !== 'product',
    );

    if (unexpectedRootFields.length > 0) {
      throw new BadRequestException(
        `XML products altında yalnızca product düğümleri olabilir: ${unexpectedRootFields.join(', ')}`,
      );
    }

    if (productEntries.length !== 1) {
      throw new BadRequestException(
        productEntries.length === 0
          ? 'XML dosyasında product kaydı bulunamadı'
          : 'XML dosyasında birden fazla product alan grubu bulunamaz',
      );
    }

    const productNodes = Array.isArray(productEntries[0][1])
      ? productEntries[0][1]
      : [productEntries[0][1]];

    if (productNodes.length === 0) {
      throw new BadRequestException('XML dosyasında ürün satırı bulunamadı');
    }

    if (productNodes.length > 10000) {
      throw new BadRequestException(
        'Tek XML dosyasında en fazla 10.000 ürün işlenebilir',
      );
    }

    const rawRows = productNodes.map((node, index) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) {
        throw new BadRequestException(
          `XML product kaydı geçerli değil: ${index + 1}`,
        );
      }

      const raw: Record<string, unknown> = {};

      for (const [xmlKey, xmlValue] of Object.entries(
        node as Record<string, unknown>,
      )) {
        const normalizedKey = this.normalizeHeader(xmlKey);
        const mappedField = this.headerAliases[normalizedKey];

        if (!mappedField) continue;

        if (
          xmlValue !== null &&
          typeof xmlValue === 'object'
        ) {
          throw new BadRequestException(
            `XML alanı iç içe olamaz: ${xmlKey} (ürün ${index + 1})`,
          );
        }

        raw[mappedField] = xmlValue;
      }

      return {
        rowNumber: index + 1,
        raw,
      };
    });

    return this.createImportJob(
      company.id,
      ProductImportSource.XML,
      fileName,
      rawRows,
    );
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

    const relatedRows: ImportRelatedRows = {};

    const variantsWorksheet = workbook.getWorksheet('Varyantlar');
    if (variantsWorksheet) {
      const variantHeaderMap = this.getRelatedHeaderMap(
        variantsWorksheet,
        this.variantHeaderAliases,
      );
      const variantFields = new Set(variantHeaderMap.values());

      if (!variantFields.has('parentSku') || !variantFields.has('name')) {
        throw new BadRequestException(
          'Varyantlar sayfasında Ana Ürün SKU ve Varyant Adı başlıkları zorunludur',
        );
      }

      relatedRows.variants = this.readRelatedExcelRows(
        variantsWorksheet,
        variantHeaderMap,
      );
    }

    const attributesWorksheet = workbook.getWorksheet('Özellikler');
    if (attributesWorksheet) {
      const attributeHeaderMap = this.getRelatedHeaderMap(
        attributesWorksheet,
        this.attributeHeaderAliases,
      );
      const attributeFields = new Set(attributeHeaderMap.values());

      if (
        !attributeFields.has('parentSku') ||
        !attributeFields.has('attributeCode') ||
        !attributeFields.has('value')
      ) {
        throw new BadRequestException(
          'Özellikler sayfasında Ana Ürün SKU, Özellik Kodu ve Değer başlıkları zorunludur',
        );
      }

      relatedRows.attributes = this.readRelatedExcelRows(
        attributesWorksheet,
        attributeHeaderMap,
      );
    }

    return this.createImportJob(
      company.id,
      ProductImportSource.EXCEL,
      fileName,
      rawRows,
      relatedRows,
    );
  }

  private async createImportJob(
    sellerId: string,
    source: ProductImportSource,
    originalFileName: string,
    rawRows: Array<{ rowNumber: number; raw: Record<string, unknown> }>,
    relatedRows: ImportRelatedRows = {},
  ) {
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

    const activeBrands = await this.prisma.brand.findMany({
      where: { isActive: true },
      select: { name: true },
    });

    const activeBrandNames = new Set(
      activeBrands.map((brand) =>
        brand.name.trim().toLocaleLowerCase('tr-TR'),
      ),
    );

    for (const row of normalizedRows) {
      const brandName = row.normalized.brand;

      if (
        brandName &&
        !activeBrandNames.has(
          brandName.trim().toLocaleLowerCase('tr-TR'),
        )
      ) {
        row.errors.push(
          `Marka sistemde bulunamadı veya aktif değil: ${brandName}`,
        );
      }
    }

    const normalizedBySku = new Map(
      normalizedRows
        .filter((row) => Boolean(row.normalized.sku))
        .map((row) => [row.normalized.sku, row]),
    );

    const variantsByParentSku = new Map<string, NormalizedImportVariant[]>();
    const variantSkusByParentSku = new Map<string, Set<string>>();

    for (const variantRow of relatedRows.variants ?? []) {
      const result = this.normalizeImportedVariant(variantRow.raw);
      const parentSku = this.text(variantRow.raw.parentSku).toUpperCase();

      if (!parentSku) {
        throw new BadRequestException(
          `Varyantlar satır ${variantRow.rowNumber}: Ana Ürün SKU zorunludur`,
        );
      }

      const parentRow = normalizedBySku.get(parentSku);

      if (!parentRow) {
        throw new BadRequestException(
          `Varyantlar satır ${variantRow.rowNumber}: Ana Ürün SKU Ürünler sayfasında bulunamadı: ${parentSku}`,
        );
      }

      parentRow.normalized.variantsProvided = true;

      if (!result.variant) {
        parentRow.errors.push(
          ...result.errors.map(
            (error) => `Varyantlar satır ${variantRow.rowNumber}: ${error}`,
          ),
        );
        continue;
      }

      const variant: ProductVariantDto = {
        name: result.variant.name,
        sku: result.variant.sku ?? undefined,
        barcode: result.variant.barcode ?? undefined,
        manufacturerCode: result.variant.manufacturerCode ?? undefined,
        price: result.variant.price ?? undefined,
        stockQuantity: result.variant.stockQuantity ?? undefined,
        isActive: result.variant.isActive,
        sortOrder: result.variant.sortOrder,
      };

      let normalizedVariant: NormalizedImportVariant;

      try {
        normalizedVariant = this.catalogService.normalizeVariants([variant])[0];
      } catch (error) {
        parentRow.errors.push(
          `Varyantlar satır ${variantRow.rowNumber}: ${
            error instanceof Error ? error.message : 'Varyant doğrulanamadı'
          }`,
        );
        continue;
      }

      if (normalizedVariant.sku) {
        const seenSkus =
          variantSkusByParentSku.get(parentSku) ?? new Set<string>();

        if (seenSkus.has(normalizedVariant.sku)) {
          parentRow.errors.push(
            `Varyantlar satır ${variantRow.rowNumber}: Aynı varyant SKU birden fazla kez kullanılamaz: ${normalizedVariant.sku}`,
          );
          continue;
        }

        seenSkus.add(normalizedVariant.sku);
        variantSkusByParentSku.set(parentSku, seenSkus);
      }

      const variants = variantsByParentSku.get(parentSku) ?? [];
      variants.push(normalizedVariant);
      variantsByParentSku.set(parentSku, variants);
    }

    for (const [parentSku, variants] of variantsByParentSku.entries()) {
      const parentRow = normalizedBySku.get(parentSku);
      if (parentRow) {
        parentRow.normalized.variants = variants;
      }
    }

    const attributeCategoryIds = [
      ...new Set(
        normalizedRows
          .map((row) => row.normalized.categoryId)
          .filter((categoryId): categoryId is string => Boolean(categoryId)),
      ),
    ];

    const categoryAttributes =
      attributeCategoryIds.length === 0
        ? []
        : await this.prisma.categoryAttribute.findMany({
            where: {
              categoryId: { in: attributeCategoryIds },
              isActive: true,
            },
            select: {
              id: true,
              categoryId: true,
              code: true,
              name: true,
              type: true,
              isRequired: true,
              options: {
                where: { isActive: true },
                select: {
                  code: true,
                },
              },
            },
          });

    const attributesByCategoryAndCode = new Map(
      categoryAttributes.map((attribute) => [
        `${attribute.categoryId}\0${attribute.code}`,
        attribute,
      ]),
    );

    const requiredAttributesByCategory = new Map<
      string,
      typeof categoryAttributes
    >();

    for (const attribute of categoryAttributes) {
      if (!attribute.isRequired) continue;

      const required =
        requiredAttributesByCategory.get(attribute.categoryId) ?? [];
      required.push(attribute);
      requiredAttributesByCategory.set(attribute.categoryId, required);
    }

    const attributeValuesByParentSku = new Map<
      string,
      NormalizedImportAttributeValue[]
    >();
    const seenAttributeIdsByParentSku = new Map<string, Set<string>>();

    for (const attributeRow of relatedRows.attributes ?? []) {
      const parentSku = this.text(
        attributeRow.raw.parentSku,
      ).toUpperCase();

      if (!parentSku) {
        throw new BadRequestException(
          `Özellikler satır ${attributeRow.rowNumber}: Ana Ürün SKU zorunludur`,
        );
      }

      const parentRow = normalizedBySku.get(parentSku);

      if (!parentRow) {
        throw new BadRequestException(
          `Özellikler satır ${attributeRow.rowNumber}: Ana Ürün SKU Ürünler sayfasında bulunamadı: ${parentSku}`,
        );
      }

      parentRow.normalized.attributeValuesProvided = true;

      if (
        attributeRow.raw.parentSku === '__FORMULA_NOT_ALLOWED__' ||
        attributeRow.raw.attributeCode === '__FORMULA_NOT_ALLOWED__'
      ) {
        parentRow.errors.push(
          `Özellikler satır ${attributeRow.rowNumber}: Excel formülü kullanılamaz`,
        );
        continue;
      }

      const categoryId = parentRow.normalized.categoryId;

      if (!categoryId) {
        parentRow.errors.push(
          `Özellikler satır ${attributeRow.rowNumber}: Ürün kategorisi bulunmadan özellik eşleştirilemez`,
        );
        continue;
      }

      const attributeCode = this.text(attributeRow.raw.attributeCode);

      if (!attributeCode) {
        parentRow.errors.push(
          `Özellikler satır ${attributeRow.rowNumber}: Özellik Kodu zorunludur`,
        );
        continue;
      }

      const attribute = attributesByCategoryAndCode.get(
        `${categoryId}\0${attributeCode}`,
      );

      if (!attribute) {
        parentRow.errors.push(
          `Özellikler satır ${attributeRow.rowNumber}: Özellik kodu seçilen kategoriye ait değil veya aktif değil: ${attributeCode}`,
        );
        continue;
      }

      const seenAttributeIds =
        seenAttributeIdsByParentSku.get(parentSku) ?? new Set<string>();

      if (seenAttributeIds.has(attribute.id)) {
        parentRow.errors.push(
          `Özellikler satır ${attributeRow.rowNumber}: Aynı özellik bir ürün için birden fazla kez kullanılamaz: ${attributeCode}`,
        );
        continue;
      }

      seenAttributeIds.add(attribute.id);
      seenAttributeIdsByParentSku.set(parentSku, seenAttributeIds);

      const result = this.normalizeImportedAttributeValue(
        attribute.id,
        attribute.type,
        attributeRow.raw.value,
      );

      if (!result.value) {
        parentRow.errors.push(
          ...result.errors.map(
            (error) => `Özellikler satır ${attributeRow.rowNumber}: ${error}`,
          ),
        );
        continue;
      }

      if (
        attribute.type === ProductAttributeType.SELECT ||
        attribute.type === ProductAttributeType.MULTI_SELECT
      ) {
        const allowedOptionCodes = new Set(
          attribute.options.map((option) => option.code),
        );
        const invalidOptionCodes = (result.value.optionCodes ?? []).filter(
          (code) => !allowedOptionCodes.has(code),
        );

        if (invalidOptionCodes.length > 0) {
          parentRow.errors.push(
            `Özellikler satır ${attributeRow.rowNumber}: Geçersiz veya aktif olmayan seçenek kodu: ${invalidOptionCodes.join(', ')}`,
          );
          continue;
        }
      }

      const values = attributeValuesByParentSku.get(parentSku) ?? [];

      values.push({
        attributeId: result.value.attributeId,
        textValue: result.value.textValue ?? null,
        numberValue: result.value.numberValue ?? null,
        booleanValue: result.value.booleanValue ?? null,
        optionCodes: result.value.optionCodes ?? [],
      });

      attributeValuesByParentSku.set(parentSku, values);
    }

    for (const [parentSku, parentRow] of normalizedBySku.entries()) {
      if (!parentRow.normalized.attributeValuesProvided) continue;

      parentRow.normalized.attributeValues =
        attributeValuesByParentSku.get(parentSku) ?? [];

      const categoryId = parentRow.normalized.categoryId;
      if (!categoryId) continue;

      const providedAttributeIds =
        seenAttributeIdsByParentSku.get(parentSku) ?? new Set<string>();

      const missingRequired = (
        requiredAttributesByCategory.get(categoryId) ?? []
      ).filter((attribute) => !providedAttributeIds.has(attribute.id));

      if (missingRequired.length > 0) {
        parentRow.errors.push(
          `Zorunlu özellikler eksik: ${missingRequired
            .map((attribute) => attribute.name)
            .join(', ')}`,
        );
      }
    }

    const classifiedRows = await this.classifyRows(
      sellerId,
      normalizedRows,
      requiredAttributesByCategory,
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
        sellerId,
        source,
        status,
        originalFileName,
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
      brand: { name: string } | null;
      barcode: string | null;
      manufacturerCode: string | null;
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
      variants: Array<{
        name: string;
        sku: string | null;
        barcode: string | null;
        manufacturerCode: string | null;
        price: Prisma.Decimal | null;
        stockQuantity: number | null;
        isActive: boolean;
        sortOrder: number;
      }>;
      attributeValues: Array<{
        attributeId: string;
        textValue: string | null;
        numberValue: Prisma.Decimal | null;
        booleanValue: boolean | null;
        optionCodes: string[];
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

    const variantsMatch =
      !normalized.variantsProvided ||
      (() => {
        const existingVariants = product.variants
          .map((variant) => ({
            name: variant.name,
            sku: variant.sku ?? null,
            barcode: variant.barcode ?? null,
            manufacturerCode: variant.manufacturerCode ?? null,
            price: variant.price === null ? null : Number(variant.price),
            stockQuantity: variant.stockQuantity,
            isActive: variant.isActive,
            sortOrder: variant.sortOrder,
          }))
          .sort(
            (a, b) =>
              a.sortOrder - b.sortOrder ||
              (a.sku ?? '').localeCompare(b.sku ?? '') ||
              a.name.localeCompare(b.name),
          );

        const expectedVariants = normalized.variants
          .map((variant) => ({
            name: variant.name,
            sku: variant.sku ?? null,
            barcode: variant.barcode ?? null,
            manufacturerCode: variant.manufacturerCode ?? null,
            price: variant.price ?? null,
            stockQuantity: variant.stockQuantity ?? null,
            isActive: variant.isActive,
            sortOrder: variant.sortOrder,
          }))
          .sort(
            (a, b) =>
              a.sortOrder - b.sortOrder ||
              (a.sku ?? '').localeCompare(b.sku ?? '') ||
              a.name.localeCompare(b.name),
          );

        return (
          existingVariants.length === expectedVariants.length &&
          existingVariants.every((variant, index) => {
            const expected = expectedVariants[index];

            return (
              variant.name === expected.name &&
              variant.sku === expected.sku &&
              variant.barcode === expected.barcode &&
              variant.manufacturerCode === expected.manufacturerCode &&
              variant.price === expected.price &&
              variant.stockQuantity === expected.stockQuantity &&
              variant.isActive === expected.isActive &&
              variant.sortOrder === expected.sortOrder
            );
          })
        );
      })();

    const attributeValuesMatch =
      !normalized.attributeValuesProvided ||
      (() => {
        const existingValues = product.attributeValues
          .map((value) => ({
            attributeId: value.attributeId,
            textValue: value.textValue ?? null,
            numberValue:
              value.numberValue === null ? null : Number(value.numberValue),
            booleanValue: value.booleanValue,
            optionCodes: [...value.optionCodes].sort(),
          }))
          .sort((a, b) => a.attributeId.localeCompare(b.attributeId));

        const expectedValues = normalized.attributeValues
          .map((value) => ({
            attributeId: value.attributeId,
            textValue: value.textValue ?? null,
            numberValue: value.numberValue ?? null,
            booleanValue: value.booleanValue ?? null,
            optionCodes: [...value.optionCodes].sort(),
          }))
          .sort((a, b) => a.attributeId.localeCompare(b.attributeId));

        return (
          existingValues.length === expectedValues.length &&
          existingValues.every((value, index) => {
            const expected = expectedValues[index];

            return (
              value.attributeId === expected.attributeId &&
              value.textValue === expected.textValue &&
              value.numberValue === expected.numberValue &&
              value.booleanValue === expected.booleanValue &&
              value.optionCodes.length === expected.optionCodes.length &&
              value.optionCodes.every(
                (code, optionIndex) =>
                  code === expected.optionCodes[optionIndex],
              )
            );
          })
        );
      })();

    return (
      (product.sku ?? '') === normalized.sku &&
      (product.brand?.name ?? '').trim().toLocaleLowerCase('tr-TR') ===
          (normalized.brand ?? '').trim().toLocaleLowerCase('tr-TR') &&
      this.sameNullableText(product.barcode, normalized.barcode) &&
      this.sameNullableText(
        product.manufacturerCode,
        normalized.manufacturerCode,
      ) &&
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
      imagesMatch &&
      variantsMatch &&
      attributeValuesMatch
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
    requiredAttributesByCategory: Map<
      string,
      Array<{ id: string; name: string }>
    >,
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
              brand: {
                select: {
                  name: true,
                },
              },
              barcode: true,
              manufacturerCode: true,
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
              variants: {
                select: {
                  name: true,
                  sku: true,
                  barcode: true,
                  manufacturerCode: true,
                  price: true,
                  stockQuantity: true,
                  isActive: true,
                  sortOrder: true,
                },
                orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              },
              attributeValues: {
                select: {
                  attributeId: true,
                  textValue: true,
                  numberValue: true,
                  booleanValue: true,
                  optionCodes: true,
                },
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
        errors.push(`İçe aktarma verisinde mükerrer SKU: ${row.normalized.sku}`);
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

      if (
        (!existing || existing.categoryId !== row.normalized.categoryId) &&
        row.normalized.categoryId
      ) {
        const requiredAttributes =
          requiredAttributesByCategory.get(row.normalized.categoryId) ?? [];

        if (requiredAttributes.length > 0) {
          const providedAttributeIds = new Set(
            row.normalized.attributeValues.map((value) => value.attributeId),
          );

          const missingRequired = requiredAttributes.filter(
            (attribute) => !providedAttributeIds.has(attribute.id),
          );

          if (missingRequired.length > 0) {
            errors.push(
              `Zorunlu özellikler eksik: ${missingRequired
                .map((attribute) => attribute.name)
                .join(', ')}`,
            );
          }
        }
      }

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

  private getRelatedHeaderMap<T extends string>(
    worksheet: ExcelJS.Worksheet,
    aliases: Record<string, T>,
  ): Map<number, T> {
    const headerRow = worksheet.getRow(1);
    const result = new Map<number, T>();

    headerRow.eachCell((cell, columnNumber) => {
      const normalized = this.normalizeHeader(cell.text);
      const field = aliases[normalized];

      if (field) {
        result.set(columnNumber, field);
      }
    });

    return result;
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

  private readRelatedExcelRows<T extends string>(
    worksheet: ExcelJS.Worksheet,
    headerMap: Map<number, T>,
  ): Array<{ rowNumber: number; raw: Record<T, unknown> }> {
    const rows: Array<{ rowNumber: number; raw: Record<T, unknown> }> = [];

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const raw = {} as Record<T, unknown>;
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
        brand: this.nullableText(raw.brand),
        barcode: this.nullableText(raw.barcode),
        manufacturerCode: this.nullableText(raw.manufacturerCode),
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
        variantsProvided: false,
        variants: [],
        attributeValuesProvided: false,
        attributeValues: [],
      },
      errors,
    };
  }

  private normalizeImportedVariant(
    raw: Record<VariantExcelField, unknown>,
  ): { variant: RawImportVariant | null; errors: string[] } {
    const errors: string[] = [];

    for (const [field, value] of Object.entries(raw)) {
      if (value === '__FORMULA_NOT_ALLOWED__') {
        errors.push(`${field} alanında Excel formülü kullanılamaz`);
      }
    }

    const parentSku = this.text(raw.parentSku).toUpperCase();
    const name = this.text(raw.name);
    const sku = this.nullableText(raw.sku)?.toUpperCase() ?? null;
    const barcode = this.nullableText(raw.barcode);
    const manufacturerCode = this.nullableText(raw.manufacturerCode);

    const price =
      this.text(raw.price) === '' ? null : this.decimal(raw.price);
    const stockQuantity =
      this.text(raw.stockQuantity) === ''
        ? null
        : this.integer(raw.stockQuantity);
    const sortOrder =
      this.text(raw.sortOrder) === '' ? 0 : this.integer(raw.sortOrder);

    const activeText = this.text(raw.isActive);
    const parsedActive =
      activeText === '' ? true : this.parseImportBoolean(raw.isActive);

    if (!parentSku) errors.push('Ana Ürün SKU zorunludur');
    if (!name) errors.push('Varyant adı zorunludur');

    if (price !== null && price < 0) {
      errors.push('Varyant fiyatı negatif olamaz');
    } else if (this.text(raw.price) !== '' && price === null) {
      errors.push('Varyant fiyatı geçerli bir sayı olmalıdır');
    }

    if (stockQuantity !== null && stockQuantity < 0) {
      errors.push('Varyant stok miktarı negatif olamaz');
    } else if (
      this.text(raw.stockQuantity) !== '' &&
      stockQuantity === null
    ) {
      errors.push('Varyant stok miktarı geçerli bir tam sayı olmalıdır');
    }

    if (sortOrder === null || sortOrder < 0) {
      errors.push('Varyant sıra değeri 0 veya daha büyük tam sayı olmalıdır');
    }

    if (parsedActive === null) {
      errors.push('Varyant Aktif alanı Evet/Hayır veya true/false olmalıdır');
    }

    if (errors.length > 0) {
      return { variant: null, errors };
    }

    return {
      variant: {
        parentSku,
        name,
        sku,
        barcode,
        manufacturerCode,
        price,
        stockQuantity,
        isActive: parsedActive ?? true,
        sortOrder: sortOrder ?? 0,
      },
      errors,
    };
  }

  private normalizeImportedAttributeValue(
    attributeId: string,
    type: ProductAttributeType,
    rawValue: unknown,
  ): { value: ProductAttributeValueDto | null; errors: string[] } {
    const errors: string[] = [];

    if (rawValue === '__FORMULA_NOT_ALLOWED__') {
      return {
        value: null,
        errors: ['Değer alanında Excel formülü kullanılamaz'],
      };
    }

    const textValue = this.text(rawValue);

    if (!textValue) {
      return {
        value: null,
        errors: ['Özellik değeri zorunludur'],
      };
    }

    if (type === ProductAttributeType.TEXT) {
      return {
        value: {
          attributeId,
          textValue,
        },
        errors,
      };
    }

    if (type === ProductAttributeType.NUMBER) {
      const numberValue = this.decimal(rawValue);

      if (numberValue === null) {
        return {
          value: null,
          errors: ['Özellik değeri geçerli bir sayı olmalıdır'],
        };
      }

      return {
        value: {
          attributeId,
          numberValue,
        },
        errors,
      };
    }

    if (type === ProductAttributeType.BOOLEAN) {
      const booleanValue = this.parseImportBoolean(rawValue);

      if (booleanValue === null) {
        return {
          value: null,
          errors: ['Özellik değeri Evet/Hayır veya true/false olmalıdır'],
        };
      }

      return {
        value: {
          attributeId,
          booleanValue,
        },
        errors,
      };
    }

    const optionCodes = [
      ...new Set(
        textValue
          .split('|')
          .map((code) => code.trim())
          .filter(Boolean),
      ),
    ];

    if (type === ProductAttributeType.SELECT && optionCodes.length !== 1) {
      return {
        value: null,
        errors: ['Tek seçimli özellik için tam bir seçenek kodu girilmelidir'],
      };
    }

    if (
      type === ProductAttributeType.MULTI_SELECT &&
      optionCodes.length === 0
    ) {
      return {
        value: null,
        errors: ['Çok seçimli özellik için en az bir seçenek kodu girilmelidir'],
      };
    }

    return {
      value: {
        attributeId,
        optionCodes,
      },
      errors,
    };
  }

  private parseImportBoolean(value: unknown): boolean | null {
    const normalized = this.normalizeHeader(value);

    if (['evet', 'true', '1'].includes(normalized)) {
      return true;
    }

    if (['hayir', 'false', '0'].includes(normalized)) {
      return false;
    }

    return null;
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
