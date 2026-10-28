import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { validateChargebackFile } from './chargeback-file-validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  ChargebackResourceType,
  ChargebackStorageService,
} from './chargeback-storage.service';

@Injectable()
export class ChargebackEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ChargebackStorageService,
  ) {}


  async getDownload(
    actor: { id: string; role: string },
    chargebackId: string,
    evidenceId: string,
  ) {
    if (!actor?.id || actor.role !== 'ADMIN') {
      throw new ForbiddenException('Sadece ADMIN belge indirebilir');
    }

    if (!chargebackId?.trim() || !evidenceId?.trim()) {
      throw new BadRequestException('Gecersiz belge kimligi');
    }

    const evidence = await this.prisma.chargebackEvidence.findFirst({
      where: {
        id: evidenceId,
        chargebackId,
      },
      select: {
        id: true,
        cloudinaryPublicId: true,
        cloudinaryResourceType: true,
        cloudinaryDeliveryType: true,
        fileType: true,
      },
    });

    if (!evidence) {
      throw new NotFoundException('Chargeback belgesi bulunamadi');
    }

    const formats: Record<string, string> = {
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };

    const format = formats[evidence.fileType || ''];

    if (
      !format ||
      !['image', 'raw'].includes(evidence.cloudinaryResourceType) ||
      evidence.cloudinaryDeliveryType !== 'authenticated'
    ) {
      throw new BadRequestException('Belge saklama bilgisi gecersiz');
    }

    const result = this.storage.createDownloadUrl(
      {
        publicId: evidence.cloudinaryPublicId,
        resourceType: evidence.cloudinaryResourceType as 'image' | 'raw',
        deliveryType: 'authenticated',
      },
      format,
    );

    return {
      evidenceId: evidence.id,
      url: result.url,
      expiresAt: result.expiresAt,
    };
  }

  async add(
    actor: { id: string; role: string },
    chargebackId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    category: string,
  ) {
    if (!actor?.id || actor.role !== 'ADMIN') {
      throw new ForbiddenException('Sadece ADMIN belge ekleyebilir');
    }

    if (!chargebackId?.trim() || !category?.trim() ||
        category.length > 100 || !file?.buffer ||
        !Buffer.isBuffer(file.buffer) ||
        file.buffer.length === 0 ||
        file.buffer.length > 10 * 1024 * 1024 ||
        file.size !== file.buffer.length) {
      throw new BadRequestException('Gecersiz chargeback belgesi');
    }

    const allowed: Record<string, ChargebackResourceType> = {
      'application/pdf': 'raw',
      'image/jpeg': 'image',
      'image/png': 'image',
      'image/webp': 'image',
    };

    const resourceType = allowed[file.mimetype];
    if (!resourceType) {
      throw new BadRequestException('Desteklenmeyen dosya turu');
    }

    const detectedType = validateChargebackFile(file.buffer, file.mimetype);

    if (detectedType !== resourceType) {
      throw new BadRequestException('Dosya icerigi ve turu uyusmuyor');
    }

    const existing = await this.prisma.chargebackCase.findUnique({
      where: { id: chargebackId },
      select: { id: true, status: true },
    });

    if (!existing) {
      throw new NotFoundException('Chargeback kaydi bulunamadi');
    }

    if (['WON', 'LOST', 'CLOSED'].includes(existing.status)) {
      throw new BadRequestException('Sonuclanmis itiraza belge eklenemez');
    }

    const sha256 = createHash('sha256')
      .update(file.buffer)
      .digest('hex');

    const stored = await this.storage.upload(file.buffer, resourceType);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{ status: string }>
        >`
          SELECT "status"::text AS "status"
          FROM "ChargebackCase"
          WHERE "id" = ${chargebackId}
          FOR UPDATE
        `;

        const current = locked[0];

        if (!current || ['WON', 'LOST', 'CLOSED'].includes(current.status)) {
          throw new BadRequestException('Chargeback durumu degisti');
        }

        const evidence = await tx.chargebackEvidence.create({
          data: {
            chargebackId,
            uploadedById: actor.id,
            category: category.trim(),
            cloudinaryPublicId: stored.publicId,
            cloudinaryResourceType: stored.resourceType,
            cloudinaryDeliveryType: stored.deliveryType,
            fileName: file.originalname.slice(0, 255),
            fileType: file.mimetype,
            sha256,
          },
          select: {
            id: true,
            chargebackId: true,
            category: true,
            sha256: true,
            createdAt: true,
          },
        });

        await tx.chargebackEvent.create({
          data: {
            chargebackId,
            actorId: actor.id,
            action: 'EVIDENCE_ADDED',
            note: 'Delil eklendi: ' + evidence.id,
          },
        });

        return evidence;
      });
    } catch (error) {
      try {
        await this.storage.remove(stored);
      } catch {
        throw new InternalServerErrorException(
          'Belge kaydi basarisiz; Cloudinary temizligi de basarisiz. Manuel inceleme gerekli.',
        );
      }
      throw error;
    }
  }
}
