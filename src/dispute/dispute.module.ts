import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { ChatModule } from '../chat/chat.module';
import { DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';

@Module({
  imports: [PrismaModule, NotificationModule, ChatModule],
  controllers: [DisputeController],
  providers: [DisputeService],
})
export class DisputeModule {}
