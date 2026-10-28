import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Actor = {
  id: string;
  role: string;
  companyId?: string;
};

@Injectable()
export class ChargebackReadService {
  constructor(private readonly prisma: PrismaService) {}

  private requireSeller(actor: Actor): string {
    if (
      !actor?.id ||
      actor.role !== 'SELLER' ||
      !actor.companyId
    ) {
      throw new ForbiddenException('Satici yetkisi gerekli');
    }
    return actor.companyId;
  }

  async sellerList(actor: Actor) {
    const companyId = this.requireSeller(actor);

    return this.prisma.chargebackCase.findMany({
      where: {
        order: { sellerId: companyId },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        providerReference: true,
        disputedAmount: true,
        currency: true,
        reason: true,
        status: true,
        notifiedAt: true,
        responseDueAt: true,
        createdAt: true,
      },
    });
  }

  async sellerDetail(actor: Actor, id: string) {
    const companyId = this.requireSeller(actor);

    if (!id?.trim()) {
      throw new NotFoundException('Itiraz bulunamadi');
    }

    const record = await this.prisma.chargebackCase.findFirst({
      where: {
        id,
        order: { sellerId: companyId },
      },
      select: {
        id: true,
        orderId: true,
        providerReference: true,
        disputedAmount: true,
        currency: true,
        reason: true,
        status: true,
        notifiedAt: true,
        responseDueAt: true,
        createdAt: true,
      },
    });

    if (!record) {
      throw new NotFoundException('Itiraz bulunamadi');
    }

    return record;
  }

  async adminDetail(id: string) {
    if (!id?.trim()) {
      throw new NotFoundException('Itiraz bulunamadi');
    }

    const record = await this.prisma.chargebackCase.findUnique({
      where: { id },
      select: {
        id: true,
        orderId: true,
        provider: true,
        providerReference: true,
        iyzicoPaymentId: true,
        disputedAmount: true,
        currency: true,
        reason: true,
        description: true,
        status: true,
        notifiedAt: true,
        responseDueAt: true,
        evidenceSubmittedAt: true,
        resolvedAt: true,
        resolutionNote: true,
        createdAt: true,
        order: {
          select: {
            sellerId: true,
            buyerId: true,
            status: true,
            totalAmount: true,
            iyzicoPaymentId: true,
          },
        },
        evidence: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            category: true,
            fileName: true,
            fileType: true,
            sha256: true,
            uploadedById: true,
            createdAt: true,
          },
        },
        events: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            action: true,
            previousStatus: true,
            nextStatus: true,
            note: true,
            actorId: true,
            createdAt: true,
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException('Itiraz bulunamadi');
    }

    return record;
  }
}
