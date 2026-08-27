import { Module } from '@nestjs/common';
import { RfqController } from './rfq.controller';
import { RfqService } from './rfq.service';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, NotificationModule, MailModule],
  controllers: [RfqController],
  providers: [RfqService],
})
export class RfqModule {}