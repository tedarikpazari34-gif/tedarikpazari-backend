import {
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  async mine(@Req() req: any) {
    return this.notificationService.getMyNotifications(
      req.user.id,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    const count =
      await this.notificationService.getUnreadCount(
        req.user.id,
      );

    return { count };
  }

  @UseGuards(JwtAuthGuard)
@Patch('read-all')
async readAll(@Req() req: any) {
  return this.notificationService.markAllAsRead(
    req.user.id,
  );
}

@UseGuards(JwtAuthGuard)
@Patch(':id/read')
async read(
  @Param('id') id: string,
  @Req() req: any,
) {
  return this.notificationService.markAsRead(
    id,
    req.user.id,
  );
}
}