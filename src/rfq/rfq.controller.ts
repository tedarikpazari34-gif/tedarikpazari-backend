import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RfqService } from './rfq.service';
import { CompanyStatusGuard } from '../common/company-status/company-status.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('RFQ')
@ApiBearerAuth()
@Controller('rfqs')
export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Post()
  @ApiOperation({ summary: 'Create RFQ (BUYER)' })
  create(@Req() req: any, @Body() body: any) {
    if (req.user.role !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER RFQ oluşturabilir');
    }

    return this.rfqService.create(req.user, body);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('mine')
  @ApiOperation({ summary: 'List my RFQs (BUYER)' })
  listMine(@Req() req: any) {
    if (req.user.role !== 'BUYER') {
      throw new ForbiddenException(
        'Sadece BUYER kendi RFQ listesini görebilir',
      );
    }

    return this.rfqService.listMine(req.user);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('open')
  @ApiOperation({ summary: 'List all OPEN RFQs (SELLER)' })
  listOpen(@Req() req: any) {
    if (req.user.role !== 'SELLER') {
      throw new ForbiddenException(
        'Sadece SELLER açık RFQları görebilir',
      );
    }

    return this.rfqService.listOpen();
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get()
  @ApiOperation({ summary: 'List RFQs for seller products (SELLER)' })
  listForSeller(@Req() req: any) {
    if (req.user.role !== 'SELLER') {
      throw new ForbiddenException(
        'Sadece SELLER kendisine gelen RFQları görebilir',
      );
    }

    return this.rfqService.listForSeller(req.user);
  }
}