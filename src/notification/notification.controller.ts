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
    return this.notificationService.getMyNotifications(req.user.id);
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