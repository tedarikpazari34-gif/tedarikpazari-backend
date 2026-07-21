import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PrismaService } from '../prisma/prisma.service';
import { SavePushTokenDto } from './dto/save-push-token.dto';

type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private firebaseReady = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(
      /\\n/g,
      '\n',
    );

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        `Firebase ortam değişkenleri eksik: ` +
          `PROJECT_ID=${Boolean(projectId)}, ` +
          `CLIENT_EMAIL=${Boolean(clientEmail)}, ` +
          `PRIVATE_KEY=${Boolean(privateKey)}`,
      );
      return;
    }

    try {
      if (getApps().length === 0) {
        initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey,
          }),
        });
      }

      this.firebaseReady = true;
      this.logger.log('Firebase Admin başarıyla başlatıldı');
    } catch (error) {
      this.logger.error(
        'Firebase Admin başlatılamadı',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async saveToken(userId: string, dto: SavePushTokenDto) {
    return this.prisma.pushSubscription.upsert({
      where: {
        token: dto.token,
      },
      update: {
        userId,
        platform: dto.platform,
        userAgent: dto.userAgent,
        isActive: true,
      },
      create: {
        userId,
        token: dto.token,
        platform: dto.platform,
        userAgent: dto.userAgent,
      },
    });
  }

  async removeToken(userId: string, token: string) {
    await this.prisma.pushSubscription.updateMany({
      where: {
        userId,
        token,
      },
      data: {
        isActive: false,
      },
    });

    return {
      success: true,
    };
  }

  async sendToUser(userId: string, payload: PushPayload) {
    if (!this.firebaseReady) {
      this.logger.warn(
        `Push gönderilmedi: Firebase hazır değil. userId=${userId}`,
      );
      return {
        success: false,
        sent: 0,
      };
    }

    const subscriptions =
      await this.prisma.pushSubscription.findMany({
        where: {
          userId,
          isActive: true,
        },
        select: {
          id: true,
          token: true,
        },
      });

    if (subscriptions.length === 0) {
      return {
        success: true,
        sent: 0,
      };
    }

    const response = await getMessaging().sendEachForMulticast({
      tokens: subscriptions.map((item) => item.token),
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        url: payload.url || '/notifications',
      },
      webpush: {
        fcmOptions: {
          link: payload.url || '/notifications',
        },
      },
    });

    const invalidSubscriptionIds: string[] = [];

    response.responses.forEach((result, index) => {
      if (result.success) return;

      const code = result.error?.code || '';

      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        invalidSubscriptionIds.push(
          subscriptions[index].id,
        );
      }

      this.logger.warn(
        `Push gönderim hatası: ${code || 'bilinmeyen hata'}`,
      );
    });

    if (invalidSubscriptionIds.length > 0) {
      await this.prisma.pushSubscription.updateMany({
        where: {
          id: {
            in: invalidSubscriptionIds,
          },
        },
        data: {
          isActive: false,
        },
      });
    }

    return {
      success: response.failureCount === 0,
      sent: response.successCount,
      failed: response.failureCount,
    };
  }
}
