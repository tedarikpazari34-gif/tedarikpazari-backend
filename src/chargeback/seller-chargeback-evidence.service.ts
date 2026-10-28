import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChargebackStorageService } from './chargeback-storage.service';
import { validateChargebackFile } from './chargeback-file-validation';

type Actor = {
  id: string;
  role: string;
  companyId?: string;
};

@Injectable()
export class SellerChargebackEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ChargebackStorageService,
  ) {}

  private requireSeller(actor: Actor): string {
    if (!actor?.id || actor.role !== 'SELLER' || !actor.companyId) {
      throw new ForbiddenException('Satici yetkisi gerekli');
    }
    return actor.companyId;
  }

  private async requireOwnCase(caseId: string, companyId: string) {
    if (!caseId?.trim()) {
      throw new NotFoundException('Itiraz bulunamadi');
    }

    const record = await this.prisma.chargebackCase.findFirst({
      where: {
        id: caseId,
        order: { sellerId: companyId },
      },
      select: { id: true, status: true },
    });

    if (!record) {
      throw new NotFoundException('Itiraz bulunamadi');
    }

    return record;
  }

  async list(actor: Actor, caseId: string) {
    const companyId = this.requireSeller(actor);
    await this.requireOwnCase(caseId, companyId);

    return this.prisma.chargebackEvidence.findMany({
      where: {
        chargebackId: caseId,
        uploadedBy: { companyId },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        category: true,
        fileName: true,
        fileType: true,
        sha256: true,
        createdAt: true,
      },
    });
  }

  async add(
    actor: Actor,
    caseId: string,
    file: Express.Multer.File,
    category: string,
  ) {
    const companyId = this.requireSeller(actor);

    if (
      !category?.trim() ||
      category.length > 100 ||
      !file?.buffer ||
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.length === 0 ||
      file.buffer.length > 10 * 1024 * 1024 ||
      file.size !== file.buffer.length
    ) {
      throw new BadRequestException('Gecersiz belge');
    }

    const allowed = {
      'application/pdf': 'raw',
      'image/jpeg': 'image',
      'image/png': 'image',
      'image/webp': 'image',
    } as const;

    const resourceType =
      allowed[file.mimetype as keyof typeof allowed];

    if (!resourceType ||
        validateChargebackFile(file.buffer, file.mimetype) !== resourceType) {
      throw new BadRequestException('Desteklenmeyen belge veya dosya icerigi');
    }

    const record = await this.requireOwnCase(caseId, companyId);

    if (!['OPEN', 'EVIDENCE_PREPARING'].includes(record.status)) {
      throw new BadRequestException('Bu asamada satici belge ekleyemez');
    }

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const stored = await this.storage.upload(file.buffer, resourceType);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ status: string }>>`
          SELECT c."status"::text AS "status"
          FROM "ChargebackCase" c
          INNER JOIN "Order" o ON o."id" = c."orderId"
          WHERE c."id" = ${caseId}
            AND o."sellerId" = ${companyId}
          FOR UPDATE OF c
        `;

        if (!rows.length) {
          throw new NotFoundException('Itiraz bulunamadi');
        }

        if (!['OPEN', 'EVIDENCE_PREPARING'].includes(rows[0].status)) {
          throw new BadRequestException('Itiraz durumu degisti');
        }

        const evidence = await tx.chargebackEvidence.create({
          data: {
            chargebackId: caseId,
            uploadedById: actor.id,
            category: category.trim(),
            cloudinaryPublicId: stored.publicId,
            cloudinaryResourceType: stored.resourceType,
            cloudinaryDeliveryType: stored.deliveryType,
            fileName: (file.originalname || 'belge').slice(0, 255),
            fileType: file.mimetype,
            sha256,
          },
          select: {
            id: true,
            chargebackId: true,
            category: true,
            fileName: true,
            sha256: true,
            createdAt: true,
          },
        });

        await tx.chargebackEvent.create({
          data: {
            chargebackId: caseId,
            actorId: actor.id,
            action: 'SELLER_EVIDENCE_ADDED',
            note: 'Satici belge ekledi: ' + evidence.id,
          },
        });

        return evidence;
      });
    } catch (error) {
      try {
        await this.storage.remove(stored);
      } catch {
        throw new InternalServerErrorException(
          'Belge kaydi basarisiz ve dosya temizligi yapilamadi; manuel inceleme gerekli',
        );
      }
      throw error;
    }
  }

  async download(actor: Actor, caseId: string, evidenceId: string) {
    const companyId = this.requireSeller(actor);

    if (!caseId?.trim() || !evidenceId?.trim()) {
      throw new NotFoundException('Belge bulunamadi');
    }

    const record = await this.prisma.chargebackEvidence.findFirst({
      where: {
        id: evidenceId,
        chargebackId: caseId,
        chargeback: {
          order: { sellerId: companyId },
        },
        uploadedBy: { companyId },
      },
      select: {
        id: true,
        cloudinaryPublicId: true,
        cloudinaryResourceType: true,
        cloudinaryDeliveryType: true,
        fileType: true,
      },
    });

    if (!record) {
      throw new NotFoundException('Belge bulunamadi');
    }

    const formats: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };

    const format = formats[record.fileType || ''];

    if (
      !format ||
      !['image', 'raw'].includes(record.cloudinaryResourceType) ||
      record.cloudinaryDeliveryType !== 'authenticated'
    ) {
      throw new BadRequestException('Gecersiz belge saklama bilgisi');
    }

    const result = this.storage.createDownloadUrl(
      {
        publicId: record.cloudinaryPublicId,
        resourceType: record.cloudinaryResourceType as 'image' | 'raw',
        deliveryType: 'authenticated',
      },
      format,
    );

    return {
      evidenceId: record.id,
      url: result.url,
      expiresAt: result.expiresAt,
    };
  }
}
