import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SavePushTokenDto } from './dto/save-push-token.dto';

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService) {}

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
}
