import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { IyzicoService } from './iyzico.service';
import { IyzicoWebhookController } from './iyzico-webhook.controller';
import { IyzicoWebhookService } from './iyzico-webhook.service';
import { IyzicoWebhookEventStore } from './iyzico-webhook-event-store';
import { IyzicoWebhookNotifier } from './iyzico-webhook-notifier.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [PrismaModule, NotificationModule, CommonModule],
  controllers: [PaymentsController, IyzicoWebhookController],
  providers: [PaymentsService, IyzicoService, IyzicoWebhookService, IyzicoWebhookEventStore, IyzicoWebhookNotifier],
  exports: [PaymentsService, IyzicoService],
})
export class PaymentsModule {}
