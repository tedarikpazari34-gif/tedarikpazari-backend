import { Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { MailModule } from '../mail/mail.module';
import { ShippingModule } from '../shipping/shipping.module';
@Module({
  imports: [PrismaModule, NotificationModule, MailModule, ShippingModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}