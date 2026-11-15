import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getJwtSecret } from '../auth/jwt-secret';

import { PrismaModule } from '../prisma/prisma.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { ChatFileAccessService } from './chat-file-access.service';
import { ChatFileStorageService } from './chat-file-storage.service';

import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatTranslationService } from './chat-translation.service';
import { ChatTranslationStoreService } from './chat-translation-store.service';
import { MailModule } from '../mail/mail.module';
@Module({
  imports: [
    PrismaModule,
    MailModule,
    CloudinaryModule,
    JwtModule.register({ secret: getJwtSecret() }),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    ChatFileAccessService,
    ChatFileStorageService,
    ChatTranslationStoreService,
    {
      provide: ChatTranslationService,
      useFactory: (store: ChatTranslationStoreService) =>
        new ChatTranslationService(null, 400_000, store),
      inject: [ChatTranslationStoreService],
    },
  ],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
