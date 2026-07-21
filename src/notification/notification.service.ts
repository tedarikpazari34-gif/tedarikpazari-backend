import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from '../chat/chat.gateway';
import { PushService } from '../push/push.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
    private readonly pushService: PushService,
  ) {}

  async createNotification(data: {
    userId: string;
    type: any;
    title: string;
    message: string;
    link?: string;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        link: data.link,
      },
    });

    this.chatGateway.emitNotificationToUser(data.userId, notification);

    void this.pushService
      .sendToUser(data.userId, {
        title: data.title,
        body: data.message,
        url: data.link || '/notifications',
      })
      .catch((error) => {
        console.error('PUSH NOTIFICATION ERROR:', error);
      });

    return notification;
  }

  async getMyNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: {
        userId,
        isRead: false,
      },
    });
  }

  async markAsRead(id: string, userId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id },
    });

    if (!notification) {
      throw new NotFoundException('Bildirim bulunamadı');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenException('Bu bildirime erişemezsiniz');
    }

    return this.prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
      },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
      },
    });
  }
}
