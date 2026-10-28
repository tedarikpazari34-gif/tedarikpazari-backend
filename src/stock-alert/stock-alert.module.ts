import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { StockAlertService } from './stock-alert.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  providers: [StockAlertService],
})
export class StockAlertModule {}
