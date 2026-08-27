import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @UseGuards(JwtAuthGuard)
  @Post('rfq/:rfqId/thread')
  createRfqThread(@Req() req: any, @Param('rfqId') rfqId: string) {
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
  @Get('threads/:threadId/messages')
  getMessages(@Req() req: any, @Param('threadId') threadId: string) {
    return this.chatService.getMessages(req.user, threadId);
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
}
