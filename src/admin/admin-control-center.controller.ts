import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminControlCenterService } from './admin-control-center.service';

@ApiTags('Admin Control Center')
@ApiBearerAuth()
@Controller('admin/control-center')
export class AdminControlCenterController {
  constructor(
    private readonly adminControlCenterService: AdminControlCenterService,
  ) {}

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  @ApiOperation({ summary: 'Admin control center status (ADMIN)' })
  getControlCenter(@Req() req: any) {
    return this.adminControlCenterService.getControlCenter(req.user);
  }
}
