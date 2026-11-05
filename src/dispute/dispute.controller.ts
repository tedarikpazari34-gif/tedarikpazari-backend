import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  ForbiddenException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DisputeService } from './dispute.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { AddDisputeFileDto } from './dto/add-dispute-file.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';
import { RespondDisputeDto } from './dto/respond-dispute.dto';
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

  // BUYER/SELLER -> dispute aç
  @UseGuards(JwtAuthGuard)
  @Post(':orderId')
  @ApiOperation({ summary: 'Open dispute for an order (BUYER/SELLER)' })
  open(
    @Req() req: any,
    @Param('orderId') orderId: string,
    @Body() body: OpenDisputeDto,
  ) {
    return this.disputeService.open(
      req.user,
      orderId,
      body.reason,
      body.description,
      body.reasonCategory,
    );
  }

  // SELLER -> respond
  @UseGuards(JwtAuthGuard)
  @Post(':id/respond')
  @ApiOperation({ summary: 'Seller respond to dispute (SELLER)' })
  respond(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: RespondDisputeDto,
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
    return this.disputeService.resolve(req.user, id, body, req.ip);
  }
  @UseGuards(JwtAuthGuard)
  @Post(':id/evidence')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Upload evidence to authorized dispute' })
  uploadEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.disputeService.uploadEvidence(req.user, id, file);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/evidence/:fileId/download')
  @ApiOperation({ summary: 'Download authorized dispute evidence' })
  downloadEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.disputeService.downloadEvidence(req.user, id, fileId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/files')
  @ApiOperation({ summary: 'Legacy URL attachment disabled' })
  addFile() {
    throw new ForbiddenException(
      'Eski dosya bağlama yöntemi kapatıldı. Güvenli kanıt yükleme API kullanın.',
    );
  }
}