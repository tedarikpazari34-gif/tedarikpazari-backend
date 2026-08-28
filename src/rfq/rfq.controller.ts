import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Req,
  UseGuards,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RfqService } from './rfq.service';
import { CompanyStatusGuard } from '../common/company-status/company-status.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('RFQ')
@ApiBearerAuth()
@Controller('rfqs')
export class RfqController {
  private readonly logger = new Logger(RfqController.name);

  constructor(private readonly rfqService: RfqService) {}

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Post()
  @ApiOperation({ summary: 'Create RFQ (BUYER)' })
  create(@Req() req: any, @Body() body: any) {
    this.logger.log(`CREATE user=${JSON.stringify(req.user)}`);

    if (req.user.role !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER RFQ oluşturabilir');
    }

    return this.rfqService.create(req.user, body);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Patch(':id/close')
  @ApiOperation({ summary: 'Close my RFQ (BUYER)' })
  close(@Req() req: any, @Param('id') id: string) {
    return this.rfqService.close(req.user, id);
  }

  @Get('public/recent')
  @ApiOperation({ summary: 'List recent OPEN RFQs for public homepage' })
  listPublicRecent() {
    return this.rfqService.listPublicRecent();
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('seller/:id')
  @ApiOperation({ summary: 'Get RFQ detail for SELLER' })
  getForSeller(@Req() req: any, @Param('id') id: string) {
    return this.rfqService.getForSellerById(req.user, id);
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get('mine')
  @ApiOperation({ summary: 'List my RFQs (BUYER)' })
  listMine(@Req() req: any) {
    this.logger.log(`MINE user=${JSON.stringify(req.user)}`);

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
    this.logger.log(`OPEN user=${JSON.stringify(req.user)}`);

    if (req.user.role !== 'SELLER') {
      throw new ForbiddenException(
        `Sadece SELLER açık RFQları görebilir. Gelen role=${req.user?.role}`,
      );
    }

    return this.rfqService.listOpen();
  }

  @UseGuards(JwtAuthGuard, CompanyStatusGuard)
  @Get()
  @ApiOperation({ summary: 'List RFQs for seller products (SELLER)' })
  listForSeller(@Req() req: any) {
    this.logger.log(`LIST user=${JSON.stringify(req.user)}`);

    if (req.user.role !== 'SELLER') {
      throw new ForbiddenException(
        'Sadece SELLER kendisine gelen RFQları görebilir',
      );
    }

    return this.rfqService.listForSeller(req.user);
  }
}