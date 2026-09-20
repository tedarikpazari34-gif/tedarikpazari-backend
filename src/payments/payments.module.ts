import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { IyzicoService } from './iyzico.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [PrismaModule, NotificationModule, CommonModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, IyzicoService],
  exports: [PaymentsService, IyzicoService],
})
export class PaymentsModule {}
