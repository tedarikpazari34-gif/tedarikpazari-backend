import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompanyStatusGuard } from '../common/company-status/company-status.guard';
import { QuoteService } from './quote.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

@ApiTags('Quote')
@ApiBearerAuth()
@Controller('quotes')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Post()
  @ApiOperation({ summary: 'Create Quote (SELLER)' })
  create(@Req() req: any, @Body() body: CreateQuoteDto) {
    if (req.user.role !== 'SELLER') {
      throw new ForbiddenException('Sadece SELLER teklif verebilir');
    }

    return this.quoteService.create(req.user, body);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('mine')
  @ApiOperation({ summary: 'List my quotes (SELLER)' })
  listMine(@Req() req: any) {
    if (req.user.role !== 'SELLER') {
      throw new ForbiddenException('Sadece SELLER kendi tekliflerini görebilir');
    }

    return this.quoteService.listMine(req.user);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('buyer')
  @ApiOperation({ summary: 'List quotes for my RFQs (BUYER)' })
  listForBuyer(@Req() req: any) {
    if (req.user.role !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER kendisine gelen teklifleri görebilir');
    }

    return this.quoteService.listForBuyer(req.user);
  }
}
