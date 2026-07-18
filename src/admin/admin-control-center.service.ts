import { ForbiddenException, Injectable } from '@nestjs/common';
import { PayoutStatus, Role } from '@prisma/client';

import { ChatGateway } from '../chat/chat.gateway';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminControlCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
  ) {}

  async getControlCenter(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN görebilir');
    }

    let databaseConnected = false;
    let databaseError: string | null = null;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      databaseConnected = true;
    } catch (error) {
      databaseError =
        error instanceof Error ? error.message : 'Veritabanı bağlantı hatası';
    }

    const [
      pendingCompanies,
      pendingProducts,
      openDisputes,
      pendingPayouts,
      flaggedMessages,
    ] = await Promise.all([
      this.prisma.company.count({
        where: { status: 'PENDING' } as any,
      }),
      this.prisma.product.count({
        where: { isApproved: false },
      }),
      this.prisma.dispute.count({
        where: {
          status: {
            in: ['OPEN', 'SELLER_RESPONDED'],
          },
        } as any,
      }),
      this.prisma.payout.count({
        where: { status: PayoutStatus.PENDING },
      }),
      this.prisma.chatMessage.count({
        where: { isFlagged: true },
      }),
    ]);

    const smtpRequiredVariables = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
    ];

    const missingSmtpVariables = smtpRequiredVariables.filter(
      (name) => !process.env[name],
    );

    return {
      checkedAt: new Date().toISOString(),

      systems: {
        backend: {
          status: 'UP',
          message: 'Backend çalışıyor',
        },
        database: {
          status: databaseConnected ? 'UP' : 'DOWN',
          message: databaseConnected
            ? 'Veritabanı bağlantısı başarılı'
            : 'Veritabanı bağlantısı başarısız',
          error: databaseError,
        },
        mail: {
          status:
            missingSmtpVariables.length === 0 ? 'CONFIGURED' : 'NOT_CONFIGURED',
          message:
            missingSmtpVariables.length === 0
              ? 'SMTP ayarları mevcut; gerçek gönderim ayrıca test edilmelidir'
              : 'SMTP ayarları eksik',
          missingVariables: missingSmtpVariables,
        },
        websocket: {
          status: this.chatGateway.isReady() ? 'UP' : 'STARTING',
          message: this.chatGateway.isReady()
            ? 'WebSocket gateway hazır'
            : 'WebSocket gateway henüz hazır değil',
          onlineUsers: this.chatGateway.getOnlineUserCount(),
        },
      },

      actions: {
        pendingCompanies,
        pendingProducts,
        openDisputes,
        pendingPayouts,
        flaggedMessages,
        total:
          pendingCompanies +
          pendingProducts +
          openDisputes +
          pendingPayouts +
          flaggedMessages,
      },
    };
  }
}
