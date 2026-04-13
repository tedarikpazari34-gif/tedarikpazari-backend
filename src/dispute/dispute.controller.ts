import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DisputeService } from './dispute.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Disputes')
@ApiBearerAuth()
@Controller('disputes')
export class DisputeController {
  constructor(private readonly disputeService: DisputeService) {}

  // BUYER/SELLER -> kendi dispute'ları
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  @ApiOperation({ summary: 'List my disputes (BUYER/SELLER)' })
  listMine(@Req() req: any) {
    return this.disputeService.listMine(req.user);
  }

  // ADMIN -> hepsi
  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiOperation({ summary: 'List all disputes (ADMIN)' })
  listAll(@Req() req: any) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Sadece ADMIN listeleyebilir');
    }
    return this.disputeService.listAll(req.user);
  }

  // BUYER -> dispute aç
  @UseGuards(JwtAuthGuard)
  @Post(':orderId')
  @ApiOperation({ summary: 'Open dispute for an order (BUYER)' })
  open(
    @Req() req: any,
    @Param('orderId') orderId: string,
    @Body() body: { reason: string; description?: string },
  ) {
    return this.disputeService.open(
      req.user,
      orderId,
      body.reason,
      body.description,
    );
  }

  // SELLER -> respond
  @UseGuards(JwtAuthGuard)
  @Post(':id/respond')
  @ApiOperation({ summary: 'Seller respond to dispute (SELLER)' })
  respond(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { sellerNote: string },
  ) {
    return this.disputeService.sellerRespond(req.user, id, body.sellerNote);
  }

  // ADMIN -> resolve (escrow hareketi tetiklenir)
  @UseGuards(JwtAuthGuard)
  @Post(':id/resolve')
  @ApiOperation({ summary: 'Resolve dispute + trigger escrow movement (ADMIN)' })
  resolve(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ResolveDisputeDto,
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('Sadece ADMIN resolve edebilir');
    }
    return this.disputeService.resolve(req.user, id, body);
  }
}