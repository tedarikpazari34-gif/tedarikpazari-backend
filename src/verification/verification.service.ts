import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationStatus } from '@prisma/client';

@Injectable()
export class VerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async createRequest(
    companyId: string,
    data: {
      documentUrl: string;
      documentType?: string;
      fileName?: string;
      publicId?: string;
      note?: string;
    },
  ) {
    if (!data.documentUrl) {
      throw new BadRequestException('Belge URL zorunludur');
    }

    const existing =
      await this.prisma.verificationRequest.findFirst({
        where: {
          companyId,
          status: VerificationStatus.PENDING,
        },
      });

    if (existing) {
      throw new BadRequestException(
        'Zaten bekleyen bir doğrulama başvurunuz var',
      );
    }

    return this.prisma.verificationRequest.create({
      data: {
        companyId,
        documentUrl: data.documentUrl,
        documentType: data.documentType || null,
        fileName: data.fileName || null,
        publicId: data.publicId || null,
        note: data.note || null,
      },
      include: {
        company: true,
      },
    });
  }

  async myRequests(companyId: string) {
    return this.prisma.verificationRequest.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
