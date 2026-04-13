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
import { PayoutService } from './payout.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Payouts')
@ApiBearerAuth()
@Controller('payouts')
export class PayoutController {
  constructor(private readonly payoutService: PayoutService) {}

  // ✅ SELLER -> kendi wallet/balance gör
  @UseGuards(JwtAuthGuard)
  @Get('me/balance')
  @ApiOperation({ summary: 'Get my wallet balance (SELLER)' })
  getMyBalance(@Req() req: any) {
    return this.payoutService.getMyBalance(req.user);
  }

  // SELLER -> payout talep et (release edilmiş order'lar için)
  @UseGuards(JwtAuthGuard)
  @Post('request')
  @ApiOperation({ summary: 'Request payout (SELLER)' })
  request(@Req() req: any) {
    return this.payoutService.request(req.user);
  }

  // ADMIN -> payout list
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'List payouts (ADMIN)' })
  list(@Req() req: any) {
    return this.payoutService.list(req.user);
  }

  // ADMIN -> approve payout
  @UseGuards(JwtAuthGuard)
  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve payout (ADMIN)' })
  approve(@Req() req: any, @Param('id') payoutId: string) {
    return this.payoutService.approve(req.user, payoutId);
  }

  // ADMIN -> reject payout
  @UseGuards(JwtAuthGuard)
  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject payout (ADMIN)' })
  reject(
    @Req() req: any,
    @Param('id') payoutId: string,
    @Body() body: { note?: string },
  ) {
    return this.payoutService.reject(req.user, payoutId, body?.note);
  }
}