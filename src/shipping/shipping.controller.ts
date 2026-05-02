import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyStatusGuard } from '../common/company-status/company-status.guard';

@Controller('shipping')
export class ShippingController {
  constructor(private readonly service: ShippingService) {}

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Post('rfq')
  create(@Req() req: any, @Body() body: any) {
    return this.service.createRFQ(req.user, body);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('open')
  list(@Req() req: any) {
    return this.service.listOpen(req.user);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Post('quote')
  quote(@Req() req: any, @Body() body: any) {
    return this.service.sendQuote(req.user, body);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('buyer')
  buyer(@Req() req: any) {
    return this.service.listQuotesForBuyer(req.user);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Post('quote/:id/accept')
  accept(@Req() req: any, @Param('id') id: string) {
    return this.service.acceptQuote(req.user, id);
  }
}