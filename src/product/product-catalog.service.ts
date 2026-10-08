import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, ProductAttributeType } from '@prisma/client';
import {
  ProductAttributeValueDto,
  ProductVariantDto,
} from './dto/create-product.dto';

@Injectable()
export class ProductCatalogService {
  async validateBrand(
    tx: Prisma.TransactionClient,
    brandId?: string | null,
  ) {
    if (!brandId) {
      return null;
    }

    const brand = await tx.brand.findFirst({
      where: {
        id: brandId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!brand) {
      throw new BadRequestException('Seçilen marka bulunamadı veya aktif değil');
    }

    return brand.id;
  }

  async resolveBrandByName(
    tx: Prisma.TransactionClient,
    brandName?: string | null,
  ): Promise<string | null> {
    const normalizedName = brandName?.trim();

    if (!normalizedName) {
      return null;
    }

    const brand = await tx.brand.findFirst({
      where: {
        name: {
          equals: normalizedName,
          mode: 'insensitive',
        },
        isActive: true,
      },
      select: { id: true },
    });

    if (!brand) {
      throw new BadRequestException(
        `Marka sistemde bulunamadı veya aktif değil: ${normalizedName}`,
      );
    }

    return brand.id;
  }

  async validateAttributeValues(
    tx: Prisma.TransactionClient,
    categoryId: string | null | undefined,
    values: ProductAttributeValueDto[],
    enforceRequired = true,
  ) {
    if (!categoryId) {
      if (values.length > 0) {
        throw new BadRequestException(
          'Kategori seçilmeden ürün özellikleri kaydedilemez',
        );
      }
      return [];
    }

    const attributes = await tx.categoryAttribute.findMany({
      where: {
        categoryId,
        isActive: true,
      },
      include: {
        options: {
          where: { isActive: true },
          select: { code: true },
        },
      },
    });

    const attributeMap = new Map(
      attributes.map((attribute) => [attribute.id, attribute]),
    );
    const seen = new Set<string>();

    for (const value of values) {
      if (seen.has(value.attributeId)) {
        throw new BadRequestException(
          'Aynı ürün özelliği birden fazla kez gönderilemez',
        );
      }
      seen.add(value.attributeId);

      const attribute = attributeMap.get(value.attributeId);
      if (!attribute) {
        throw new BadRequestException(
          'Ürün özelliği seçilen kategoriye ait değil veya aktif değil',
        );
      }

      const hasText =
        typeof value.textValue === 'string' &&
        value.textValue.trim().length > 0;
      const hasNumber = value.numberValue !== undefined;
      const hasBoolean = value.booleanValue !== undefined;
      const optionCodes = [
        ...new Set(
          (value.optionCodes ?? [])
            .map((code) => code.trim())
            .filter(Boolean),
        ),
      ];

      if (attribute.type === ProductAttributeType.TEXT) {
        if (!hasText || hasNumber || hasBoolean || optionCodes.length > 0) {
          throw new BadRequestException(
            `${attribute.name} özelliği geçerli bir metin değeri gerektirir`,
          );
        }
      } else if (attribute.type === ProductAttributeType.NUMBER) {
        if (hasText || !hasNumber || hasBoolean || optionCodes.length > 0) {
          throw new BadRequestException(
            `${attribute.name} özelliği geçerli bir sayısal değer gerektirir`,
          );
        }
      } else if (attribute.type === ProductAttributeType.BOOLEAN) {
        if (hasText || hasNumber || !hasBoolean || optionCodes.length > 0) {
          throw new BadRequestException(
            `${attribute.name} özelliği evet/hayır değeri gerektirir`,
          );
        }
      } else {
        const expectedCount =
          attribute.type === ProductAttributeType.SELECT ? 1 : null;

        if (
          hasText ||
          hasNumber ||
          hasBoolean ||
          optionCodes.length === 0 ||
          (expectedCount !== null && optionCodes.length !== expectedCount)
        ) {
          throw new BadRequestException(
            `${attribute.name} özelliği için geçerli seçenek seçilmelidir`,
          );
        }

        const allowed = new Set(
          attribute.options.map((option) => option.code),
        );
        if (optionCodes.some((code) => !allowed.has(code))) {
          throw new BadRequestException(
            `${attribute.name} özelliğinde geçersiz seçenek bulunuyor`,
          );
        }
      }
    }

    if (enforceRequired) {
      const missing = attributes.filter(
        (attribute) => attribute.isRequired && !seen.has(attribute.id),
      );

      if (missing.length > 0) {
        throw new BadRequestException(
          `Zorunlu ürün özellikleri eksik: ${missing
            .map((attribute) => attribute.name)
            .join(', ')}`,
        );
      }
    }

    return values.map((value) => ({
      attributeId: value.attributeId,
      textValue: value.textValue?.trim() || null,
      numberValue:
        value.numberValue !== undefined ? value.numberValue : null,
      booleanValue:
        value.booleanValue !== undefined ? value.booleanValue : null,
      optionCodes: [
        ...new Set(
          (value.optionCodes ?? [])
            .map((code) => code.trim())
            .filter(Boolean),
        ),
      ],
    }));
  }

  normalizeVariants(variants: ProductVariantDto[]) {
    const seenSkus = new Set<string>();

    return variants.map((variant, index) => {
      const name = variant.name?.trim();
      if (!name) {
        throw new BadRequestException('Varyant adı zorunludur');
      }

      const sku = variant.sku?.trim().toUpperCase() || null;
      if (sku) {
        if (seenSkus.has(sku)) {
          throw new BadRequestException(
            `Aynı varyant SKU kodu birden fazla kez kullanılamaz: ${sku}`,
          );
        }
        seenSkus.add(sku);
      }

      return {
        name,
        sku,
        barcode: variant.barcode?.trim() || null,
        manufacturerCode: variant.manufacturerCode?.trim() || null,
        price: variant.price ?? null,
        stockQuantity: variant.stockQuantity ?? null,
        isActive: variant.isActive ?? true,
        sortOrder: variant.sortOrder ?? index,
      };
    });
  }
}
