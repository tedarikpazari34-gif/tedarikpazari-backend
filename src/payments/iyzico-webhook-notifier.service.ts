import { Injectable, Logger } from '@nestjs/common';
import { Notification, NotificationType, Prisma, Role } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class IyzicoWebhookNotifier {
  private readonly logger = new Logger(IyzicoWebhookNotifier.name);

  constructor(
    private readonly notifications: NotificationService,
  ) {}

  async stage(
    tx: Prisma.TransactionClient,
    webhookEventId: string,
  ): Promise<Notification[]> {
    const event = await tx.iyzicoWebhookEvent.findUnique({
      where: { id: webhookEventId },
      select: { id: true, status: true },
    });

    if (!event || event.status !== 'INVESTIGATION_REQUIRED') {
      return [];
    }

    const admins = await tx.user.findMany({
      where: { company: { role: Role.ADMIN } },
      select: { id: true },
    });

    const staged: Notification[] = [];

    for (const admin of admins) {
      const existing = await tx.iyzicoWebhookNotification.findUnique({
        where: {
          webhookEventId_adminUserId: {
            webhookEventId,
            adminUserId: admin.id,
          },
        },
        select: { id: true },
      });

      if (existing) continue;

      const notification = await tx.notification.create({
        data: {
          userId: admin.id,
          type: NotificationType.SYSTEM,
          title: 'iyzico webhook incelemesi',
          message: 'Bir ödeme bildirimi yönetici incelemesi gerektiriyor.',
          link: '/admin/finance',
        },
      });

      await tx.iyzicoWebhookNotification.create({
        data: {
          webhookEventId,
          adminUserId: admin.id,
          notificationId: notification.id,
        },
      });

      staged.push(notification);
    }

    return staged;
  }

  publish(staged: Notification[]): void {
    for (const notification of staged) {
      try {
        this.notifications.publishStoredNotification(notification);
      } catch {
        this.logger.warn(
          'Webhook bildirimi kaydedildi fakat anlık yayın başarısız',
        );
      }
    }
  }
}
