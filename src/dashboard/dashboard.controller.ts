import { Controller, Get, Req, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('buyer')
  buyer(@Req() req: any) {
    return this.dashboardService.buyerDashboard(req.user);
  }

  @Get('seller')
  seller(@Req() req: any) {
    return this.dashboardService.sellerDashboard(req.user);
  }

  @Get('logistics')
  logistics(@Req() req: any) {
    return this.dashboardService.logisticsDashboard(req.user);
  }

  @Get('admin')
  admin(@Req() req: any) {
    return this.dashboardService.adminDashboard(req.user);
  }
}
