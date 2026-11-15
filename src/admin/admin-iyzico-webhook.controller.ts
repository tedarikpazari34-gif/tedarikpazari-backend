import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminIyzicoWebhookService } from './admin-iyzico-webhook.service';

@Controller('admin/iyzico-webhooks')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminIyzicoWebhookController {
  constructor(
    private readonly webhook: AdminIyzicoWebhookService,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    if (
      status !== undefined &&
      status !== 'RECEIVED' &&
      status !== 'INVESTIGATION_REQUIRED'
    ) {
      throw new BadRequestException('Gecersiz webhook durum filtresi');
    }

    return this.webhook.listEvents(status);
  }
}
