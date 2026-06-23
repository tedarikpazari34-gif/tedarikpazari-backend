import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminMetricsService } from './admin-metrics.service';

@ApiTags('Admin Metrics')
@ApiBearerAuth()
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly adminMetricsService: AdminMetricsService) {}

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('overview')
  @ApiOperation({ summary: 'Admin metrics overview (ADMIN)' })
  overview(@Req() req: any) {
    return this.adminMetricsService.overview(req.user);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('timeseries')
  @ApiOperation({ summary: 'Admin metrics timeseries (ADMIN)' })
  timeseries(@Req() req: any) {
    return this.adminMetricsService.timeseries(req.user);
  }
}