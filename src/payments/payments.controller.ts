import {
  Body,
  Controller,
  Get,
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
import { CreateIyzicoSubMerchantDto } from './dto/create-iyzico-submerchant.dto';
import { ResolveIyzicoPaymentReviewDto } from './dto/resolve-iyzico-payment-review.dto';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('iyzico/submerchant')
  @ApiOperation({ summary: 'Create iyzico Marketplace sub merchant for seller' })
  createSubMerchant(
    @Req() req: any,
    @Body() body: CreateIyzicoSubMerchantDto,
  ) {
    return this.payments.createIyzicoSubMerchant(req.user, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('iyzico/submerchant/reconcile/:companyId')
  @ApiOperation({ summary: 'Reconcile iyzico Marketplace sub merchant (ADMIN)' })
  reconcileSubMerchant(
    @Req() req: any,
    @Param('companyId') companyId: string,
  ) {
    return this.payments.reconcileIyzicoSubMerchant(req.user, companyId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('iyzico/:orderId/initialize')
  @ApiOperation({ summary: 'Initialize iyzico checkout' })
  initialize(@Req() req: any, @Param('orderId') orderId: string) {
    return this.payments.initializeIyzico(req.user, orderId, req.ip);
  }

  @UseGuards(JwtAuthGuard)
  @Get('iyzico/reviews')
  @ApiOperation({ summary: 'List iyzico payment attempts awaiting review' })
  listReviews(@Req() req: any) {
    return this.payments.listIyzicoPaymentReviews(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('iyzico/inspect/:paymentAttemptId')
  @ApiOperation({ summary: 'Inspect an existing iyzico payment attempt without modifying it' })
  inspect(
    @Req() req: any,
    @Param('paymentAttemptId') paymentAttemptId: string,
  ) {
    return this.payments.inspectIyzicoPayment(req.user, paymentAttemptId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('iyzico/reconcile/:paymentAttemptId')
  @ApiOperation({ summary: 'Reconcile an existing iyzico payment attempt' })
  reconcile(
    @Req() req: any,
    @Param('paymentAttemptId') paymentAttemptId: string,
  ) {
    return this.payments.reconcileIyzicoPayment(req.user, paymentAttemptId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('iyzico/resolve-review-failed/:paymentAttemptId')
  @ApiOperation({
    summary: 'Resolve an iyzico REVIEW payment attempt as FAILED',
  })
  resolveReviewAsFailed(
    @Req() req: any,
    @Param('paymentAttemptId') paymentAttemptId: string,
    @Body() body: ResolveIyzicoPaymentReviewDto,
  ) {
    return this.payments.resolveIyzicoPaymentReviewAsFailed(
      req.user,
      paymentAttemptId,
      body,
      req.ip,
      req.headers?.['user-agent'],
    );
  }

  @Post('iyzico/callback')
  @ApiOperation({ summary: 'iyzico callback' })
  async callback(@Body() body: { token?: string }, @Res() res: Response) {
    try {
      const result = await this.payments.handleIyzicoCallback(body.token || '');

      const frontendUrl =
        process.env.FRONTEND_URL || 'https://xn--tedarikpazar-d5b.com';

      if (
        result &&
        'paymentStatus' in result &&
        result.paymentStatus === 'REVIEW'
      ) {
        return res.redirect(303, `${frontendUrl}/buyer/orders?payment=review`);
      }

      return res.redirect(303, `${frontendUrl}/buyer/orders?payment=success`);
    } catch (error) {
      const safeError =
        error instanceof Error ? error.message : 'Bilinmeyen callback hatası';

      console.error('IYZICO CALLBACK ERROR:', safeError);

      const frontendUrl =
        process.env.FRONTEND_URL || 'https://xn--tedarikpazar-d5b.com';

      return res.redirect(303, `${frontendUrl}/buyer/orders?payment=failed`);
    }
  }
}
