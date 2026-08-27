import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { WalletService } from './wallet.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';

@ApiTags('Wallet')
@ApiBearerAuth()
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get my wallet' })
  getMine(@Req() req: any) {
    return this.walletService.getMine(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/history')
  @ApiOperation({ summary: 'Get my wallet transaction history' })
  getMyHistory(@Req() req: any) {
    return this.walletService.getHistory(req.user);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('admin-adjust')
  @ApiOperation({ summary: 'Admin wallet adjustment' })
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