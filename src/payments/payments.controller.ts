import { Controller, Post, Param, Body, Req, UseGuards } from '@nestjs/common';
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
    return this.payments.initializeIyzico(req.user, orderId);
  }

  @Post('iyzico/callback')
  @ApiOperation({ summary: 'iyzico callback' })
  callback(@Body() body: any) {
    return this.payments.handleIyzicoCallback(body.token);
  }

}