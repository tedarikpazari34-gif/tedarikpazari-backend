import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('iyzico/:orderId/initialize')
  @ApiOperation({ summary: 'Initialize iyzico checkout' })
  initialize(@Req() req: any, @Param('orderId') orderId: string) {
    return this.payments.initializeIyzico(req.user, orderId, req.ip);
  }

  @Post('iyzico/callback')
  @ApiOperation({ summary: 'iyzico callback' })
  async callback(@Body() body: { token?: string }, @Res() res: Response) {
    try {
      await this.payments.handleIyzicoCallback(body.token || '');

      const frontendUrl =
        process.env.FRONTEND_URL || 'https://xn--tedarikpazar-d5b.com';

      return res.redirect(303, `${frontendUrl}/buyer/orders?payment=success`);
    } catch (error) {
      console.error('IYZICO CALLBACK ERROR:', error);

      const frontendUrl =
        process.env.FRONTEND_URL || 'https://xn--tedarikpazar-d5b.com';

      return res.redirect(303, `${frontendUrl}/buyer/orders?payment=failed`);
    }
  }
}
