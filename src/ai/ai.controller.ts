import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @UseGuards(JwtAuthGuard)
  @Post('rfq-draft')
  createRfqDraft(
    @Req() req: any,
    @Body() body: { prompt: string },
  ) {
    return this.aiService.createRfqDraft(body.prompt);
  }
}
