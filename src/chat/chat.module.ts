import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';

import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { MailModule } from '../mail/mail.module';
@Module({
  imports: [PrismaModule, MailModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
