import { ServiceUnavailableException } from '@nestjs/common';
import {
  BadRequestException,
  Body,
  UploadedFile,
  UseInterceptors,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CHAT_FILE_MAX_BYTES } from './chat-file-policy';
import { ChatFileUploadEnabledGuard } from './chat-file-upload-enabled.guard';
import { ChatFileContentReviewGuard } from './chat-file-content-review.guard';
import { ChatFileAccessService } from './chat-file-access.service';

// Fail closed until actual content security scanning is complete.
const CHAT_FILE_CONTENT_SCANNING_READY = false;

const FIRST_RELEASE_RFQ_CHAT_ENABLED = false;

@Controller('chat')
export class ChatController {
  @Inject(ChatFileAccessService)
  private readonly chatFileAccess!: ChatFileAccessService;

  constructor(private readonly chatService: ChatService) {}

  @UseGuards(JwtAuthGuard)
  @Post('rfq/:rfqId/thread')
  createRfqThread(@Req() req: any, @Param('rfqId') rfqId: string) {
    if (!FIRST_RELEASE_RFQ_CHAT_ENABLED) {
      throw new ServiceUnavailableException('Urun RFQ sohbeti kapali');
    }
    return this.chatService.createThreadForRfq(req.user, rfqId);
  }
  @UseGuards(JwtAuthGuard)
@Post('order/:orderId/thread')
createOrderThread(
  @Req() req: any,
  @Param('orderId') orderId: string,
) {
  return this.chatService.createThreadForOrder(
    req.user,
    orderId,
  );
}
  @UseGuards(JwtAuthGuard)
@Get('admin/flagged')
listFlagged(@Req() req: any) {
  return this.chatService.listFlaggedMessages(req.user);
}
  @UseGuards(JwtAuthGuard)
  @Post('admin/files/:reviewId/review')
  reviewPendingChatFile(
    @Req() req: any,
    @Param('reviewId') reviewId: string,
    @Body() body: { decision?: string; note?: unknown },
  ) {
    if (
      !CHAT_FILE_CONTENT_SCANNING_READY &&
      body?.decision === 'APPROVED'
    ) {
      throw new ServiceUnavailableException(
        'Dosya guvenlik taramasi tamamlanmadan onay verilemez',
      );
    }

    return this.chatService.reviewPendingChatFile(
      req.user,
      reviewId,
      body?.decision as string,
      body?.note,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/files/:reviewId/preview')
  previewPendingChatFile(
    @Req() req: any,
    @Param('reviewId') reviewId: string,
  ) {
    if (!CHAT_FILE_CONTENT_SCANNING_READY) {
      throw new ServiceUnavailableException(
        'Dosya guvenlik taramasi tamamlanmadan onizleme acilamaz',
      );
    }

    return this.chatFileAccess.getAdminReviewDownload(
      req.user,
      reviewId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/files/pending')
  listPendingFileReviews(
    @Req() req: any,
    @Query('cursor') cursor?: string,
  ) {
    return this.chatService.listPendingFileReviews(req.user, cursor);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/flagged/:messageId/review')
  reviewFlagged(
    @Req() req: any,
    @Param('messageId') messageId: string,
    @Body() body: { decision?: string; note?: unknown },
  ) {
    return this.chatService.reviewFlaggedMessage(
      req.user,
      messageId,
      body?.decision as string,
      body?.note,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/company/:companyId/message')
  sendAdminCompanyMessage(
    @Req() req: any,
    @Param('companyId') companyId: string,
    @Body() body: { content: string },
  ) {
    return this.chatService.sendAdminCompanyMessage(
      req.user,
      companyId,
      body.content,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('threads')
  listMine(@Req() req: any) {
    return this.chatService.listMine(req.user);
  }
  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  getUnreadCount(@Req() req: any) {
  return this.chatService.getUnreadCount(req.user);
} 
  @UseGuards(JwtAuthGuard)
  @Get('threads/:threadId/my-file-reviews')
  listMyChatFileReviews(
    @Req() req: any,
    @Param('threadId') threadId: string,
  ) {
    return this.chatService.listMyChatFileReviews(
      req.user,
      threadId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('threads/:threadId/messages')
  getMessages(@Req() req: any, @Param('threadId') threadId: string, @Query('lang') lang?: string) {
    return this.chatService.getMessages(req.user, threadId, lang);
  }

  @UseGuards(JwtAuthGuard)
  @Post('threads/:threadId/messages')
  sendMessage(
    @Req() req: any,
    @Param('threadId') threadId: string,
    @Body() body: { content: string },
  ) {
    return this.chatService.sendMessage(req.user, threadId, body.content);
  }

  @UseGuards(JwtAuthGuard)
  @Get('threads/:threadId/files/:messageId')
  downloadChatFile(
    @Req() req: any,
    @Param('threadId') threadId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chatFileAccess.getDownload(
      req.user,
      threadId,
      messageId,
    );
  }

  @UseGuards(
    JwtAuthGuard,
    ChatFileUploadEnabledGuard,
    ChatFileContentReviewGuard,
  )
  @Post('threads/:threadId/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: CHAT_FILE_MAX_BYTES,
        files: 1,
      },
    }),
  )
  uploadChatFile(
    @Req() req: any,
    @Param('threadId') threadId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Dosya bulunamadi');
    }

    return this.chatService.sendFileMessage(
      req.user,
      threadId,
      file,
    );
  }
}
