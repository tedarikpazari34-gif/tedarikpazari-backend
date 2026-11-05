import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceStorageService } from './invoice-storage.service';

@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: InvoiceStorageService,
  ) {}

  private requireRole(user: any, roles: Role[]) {
    if (
      !user ||
      !roles.includes(user.role) ||
      (user.role !== Role.ADMIN &&
        (typeof user.companyId !== 'string' || !user.companyId))
    ) {
      throw new ForbiddenException('Fatura erişim yetkisi bulunmuyor');
    }
  }

  // Alıcı kendi alış faturalarını, satıcı kendi satış
  // faturalarını görüntüler. Şirketler arası kayıt sızmaz.
  async listMine(user: any) {
    this.requireRole(user, [Role.BUYER, Role.SELLER]);

    const visibility = [
      { status: 'RECORDED' as const },
      { issuerCompanyId: user.companyId },
    ];

    const where =
      user.role === Role.BUYER
        ? { buyerId: user.companyId, OR: visibility }
        : { sellerId: user.companyId, OR: visibility };

    return this.prisma.invoiceRecord.findMany({
      where,
      select: {
        id: true,
        orderId: true,
        kind: true,
        channel: true,
        status: true,
        invoiceNumber: true,
        revision: true,
        originalSaleInvoiceId: true,
        issuedAt: true,
        currency: true,
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
        reviewedAt: true,
        reviewNote: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // Yönetici tüm kayıtları denetleyebilir.
  // Özel dosya referansları listeleme API'sinden dönmez.
  async listAdmin(user: any) {
    this.requireRole(user, [Role.ADMIN]);

    return this.prisma.invoiceRecord.findMany({
      select: {
        id: true,
        orderId: true,
        buyerId: true,
        sellerId: true,
        issuerCompanyId: true,
        kind: true,
        channel: true,
        status: true,
        invoiceNumber: true,
        revision: true,
        originalSaleInvoiceId: true,
        issuedAt: true,
        currency: true,
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
        providerName: true,
        reviewedByUserId: true,
        reviewedAt: true,
        reviewNote: true,
        providerDocumentId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // Önce kayıt sahipliği doğrulanır.
  // Sonraki aşamada özel Cloudinary indirme bağlantısı
  // yalnızca bu kontrolden sonra üretilecek.
  private async getAuthorizedRecord(user: any, invoiceId: string) {
    this.requireRole(user, [
      Role.BUYER,
      Role.SELLER,
      Role.ADMIN,
    ]);

    if (!invoiceId || typeof invoiceId !== 'string') {
      throw new BadRequestException('Fatura kimliği gerekli');
    }

    const record = await this.prisma.invoiceRecord.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        orderId: true,
        buyerId: true,
        sellerId: true,
        issuerCompanyId: true,
        status: true,
        fileMimeType: true,
        storagePublicId: true,
        storageResourceType: true,
        storageDeliveryType: true,
      },
    });

    if (!record) {
      throw new NotFoundException('Fatura bulunamadı');
    }

    const belongsToCompany =
      (user.role === Role.BUYER &&
        record.buyerId === user.companyId) ||
      (user.role === Role.SELLER &&
        record.sellerId === user.companyId);

    const visible =
      record.status === 'RECORDED' ||
      record.issuerCompanyId === user.companyId;

    if (
      user.role !== Role.ADMIN &&
      (!belongsToCompany || !visible)
    ) {
      throw new NotFoundException('Fatura bulunamadı');
    }

    if (
      record.fileMimeType !== 'application/pdf' ||
      record.storageResourceType !== 'raw' ||
      record.storageDeliveryType !== 'authenticated' ||
      typeof record.storagePublicId !== 'string' ||
        !/^tedarik-pazari-platform\/invoices\/[A-Za-z0-9_-]+$/.test(
          record.storagePublicId,
        )
    ) {
      throw new BadRequestException(
        'Faturanın güvenli belge bilgisi doğrulanamadı'
      );
    }

    return record;
  }

  async verifyDownloadAccess(user: any, invoiceId: string) {
    const record = await this.getAuthorizedRecord(user, invoiceId);

    return {
      invoiceId: record.id,
      authorized: true,
    };
  }

  async download(user: any, invoiceId: string) {
    const record = await this.getAuthorizedRecord(user, invoiceId);

    const result = this.storage.createDownloadUrl(
      {
        publicId: record.storagePublicId,
        resourceType: 'raw',
        deliveryType: 'authenticated',
      },
      'pdf',
    );

    return {
      invoiceId: record.id,
      url: result.url,
      expiresAt: result.expiresAt,
    };
  }
}
