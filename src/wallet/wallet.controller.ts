import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @UseGuards(JwtAuthGuard)
  @Post('admin-adjust')
  adminAdjust(
    @Req() req: any,
    @Body() body: { companyId: string; amount: number; note?: string },
  ) {
    return this.walletService.adminAdjust(
      req.user,
      body.companyId,
      body.amount,
      body.note,
    );
  }
}