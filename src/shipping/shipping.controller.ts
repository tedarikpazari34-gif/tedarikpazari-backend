import {
  Body,
  ServiceUnavailableException,
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

const FIRST_RELEASE_SHIPPING_ENABLED = false;

@Controller('shipping')
export class ShippingController {
  constructor(private readonly service: ShippingService) {}

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Post('rfq')
  create(@Req() req: any, @Body() body: any) {
    if (!FIRST_RELEASE_SHIPPING_ENABLED) {
      throw new ServiceUnavailableException(
        'Nakliye teklif hizmeti şu anda kullanıma kapalı',
      );
    }
    return this.service.createRFQ(req.user, body);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('open')
  list(@Req() req: any) {
    if (!FIRST_RELEASE_SHIPPING_ENABLED) {
      throw new ServiceUnavailableException('Nakliye teklif pazaryeri kapali');
    }
    return this.service.listOpen(req.user);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Post('quote')
  quote(@Req() req: any, @Body() body: any) {
    if (!FIRST_RELEASE_SHIPPING_ENABLED) {
      throw new ServiceUnavailableException(
        'Nakliye teklif hizmeti şu anda kullanıma kapalı',
      );
    }
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
    if (!FIRST_RELEASE_SHIPPING_ENABLED) {
      throw new ServiceUnavailableException(
        'Nakliye teklif hizmeti şu anda kullanıma kapalı',
      );
    }
    return this.service.acceptQuote(req.user, id);
  }
  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
@Get("orders")
orders(@Req() req: any) {
  return this.service.listShippingOrders(req.user);
}

@UseGuards(JwtAuthGuard, CompanyStatusGuard)
@Post("orders/:id/pickup")
pickup(@Req() req: any, @Param("id") id: string) {
  if (!FIRST_RELEASE_SHIPPING_ENABLED) {
      throw new ServiceUnavailableException('Nakliye teklif pazaryeri kapali');
    }
    return this.service.pickup(req.user, id);
}

@UseGuards(JwtAuthGuard, CompanyStatusGuard)
@Post("orders/:id/transit")
transit(@Req() req: any, @Param("id") id: string) {
  if (!FIRST_RELEASE_SHIPPING_ENABLED) {
      throw new ServiceUnavailableException('Nakliye teklif pazaryeri kapali');
    }
    return this.service.transit(req.user, id);
}

@UseGuards(JwtAuthGuard, CompanyStatusGuard)
@Post("orders/:id/deliver")
deliver(@Req() req: any, @Param("id") id: string) {
  if (!FIRST_RELEASE_SHIPPING_ENABLED) {
      throw new ServiceUnavailableException('Nakliye teklif pazaryeri kapali');
    }
    return this.service.deliver(req.user, id);
}
}
