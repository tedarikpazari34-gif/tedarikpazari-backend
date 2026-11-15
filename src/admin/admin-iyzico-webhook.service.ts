import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminIyzicoWebhookService {
  constructor(private readonly prisma: PrismaService) {}

  async listEvents(status?: string) {
    const allowed = ['RECEIVED', 'INVESTIGATION_REQUIRED'];

    const normalized = status?.trim();

    if (normalized && !allowed.includes(normalized)) {
      return [];
    }

    return this.prisma.iyzicoWebhookEvent.findMany({
      where: normalized ? { status: normalized } : {},
      select: {
        id: true,
        paymentAttemptId: true,
        orderId: true,
        paymentId: true,
        conversationId: true,
        eventType: true,
        paymentStatus: true,
        status: true,
        receivedAt: true,
        processedAt: true,
        lastReceivedAt: true,
        deliveryCount: true,
        reviewReason: true,
      },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
  }
}
