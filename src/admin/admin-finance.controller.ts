import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminFinanceService } from './admin-finance.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Admin Finance')
@ApiBearerAuth()
@Controller('admin')
export class AdminFinanceController {
  constructor(private readonly adminFinanceService: AdminFinanceService) {}

  @UseGuards(JwtAuthGuard)
  @Get('ledger')
  @ApiOperation({ summary: 'List ledger entries (ADMIN)' })
  listLedger(@Req() req: any, @Query('take') take?: string) {
    const n = take ? Number(take) : 50;
    return this.adminFinanceService.listLedger(req.user, Number.isFinite(n) ? n : 50);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sellers/:sellerId/balance')
  @ApiOperation({ summary: 'Get seller balance snapshot (ADMIN)' })
  getSellerBalance(@Req() req: any, @Param('sellerId') sellerId: string) {
    return this.adminFinanceService.getSellerBalance(req.user, sellerId);
  }
}