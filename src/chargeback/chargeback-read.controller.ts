import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { ChargebackReadService } from './chargeback-read.service';

@ApiTags('Seller Chargeback')
@ApiBearerAuth()
@Controller('seller/chargebacks')
@UseGuards(JwtAuthGuard)
export class SellerChargebackController {
  constructor(private readonly service: ChargebackReadService) {}

  @Get()
  list(@Req() req: any) {
    return this.service.sellerList(req.user);
  }

  @Get(':id')
  detail(@Req() req: any, @Param('id') id: string) {
    return this.service.sellerDetail(req.user, id);
  }
}

@ApiTags('Admin Chargeback Detail')
@ApiBearerAuth()
@Controller('admin/chargebacks')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ChargebackReadController {
  constructor(private readonly service: ChargebackReadService) {}

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.adminDetail(id);
  }
}
