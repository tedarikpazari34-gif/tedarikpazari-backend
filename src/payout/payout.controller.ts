import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { PayoutService } from './payout.service';

@ApiTags('Payouts')
@ApiBearerAuth()
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me/balance')
  @ApiOperation({ summary: 'Get my wallet balance (SELLER)' })
  getMyBalance(@Req() req: any) {
    return this.payoutService.getMyBalance(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/requests')
  @ApiOperation({ summary: 'Get my payout requests (SELLER)' })
  myRequests(@Req() req: any) {
    return this.payoutService.myRequests(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('request')
  @ApiOperation({ summary: 'Request payout (SELLER)' })
  request(
    @Req() req: any,
    @Body() body: { amount: number; iban: string },
  ) {
    return this.payoutService.request(req.user, body);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  @ApiOperation({ summary: 'List payout requests (ADMIN)' })
  list(@Req() req: any) {
    return this.payoutService.list(req.user);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve payout request (ADMIN)' })
  approve(@Req() req: any, @Param('id') payoutId: string) {
    return this.payoutService.approve(req.user, payoutId);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject payout request (ADMIN)' })
  reject(
    @Req() req: any,
    @Param('id') payoutId: string,
    @Body() body: { note?: string },
  ) {
    return this.payoutService.reject(req.user, payoutId, body?.note);
  }
}