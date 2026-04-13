import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @UseGuards(JwtAuthGuard)
  @Post('from-quote/:quoteId')
  createFromQuote(@Req() req: any, @Param('quoteId') quoteId: string) {
    return this.orderService.createFromQuote(req.user, quoteId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Req() req: any) {
    return this.orderService.list(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getOne(@Req() req: any, @Param('id') id: string) {
    return this.orderService.getOne(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/pay')
  pay(@Req() req: any, @Param('id') id: string) {
    return this.orderService.pay(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/prepare')
  prepare(@Req() req: any, @Param('id') id: string) {
    return this.orderService.prepare(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/ship')
  ship(@Req() req: any, @Param('id') id: string) {
    return this.orderService.ship(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/complete')
  complete(@Req() req: any, @Param('id') id: string) {
    return this.orderService.complete(req.user, id);
  }
}