import {
  Controller,
  Optional,
  Get,
  Param,
  Post,
  Req,
  Body,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SellerChargebackEvidenceService } from './seller-chargeback-evidence.service';
import { ChargebackNotifier } from './chargeback-notifier.service';

@ApiTags('Seller Chargeback Evidence')
@ApiBearerAuth()
@Controller('seller/chargebacks')
@UseGuards(JwtAuthGuard)
export class SellerChargebackEvidenceController {
  constructor(
    private readonly evidence: SellerChargebackEvidenceService,
    @Optional() private readonly notifier?: ChargebackNotifier,
  ) {}

  @Get(':id/evidence')
  list(@Req() req: any, @Param('id') id: string) {
    return this.evidence.list(req.user, id);
  }

  @Post(':id/evidence')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  }))
  async upload(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: string,
  ) {
    const result = await this.evidence.add(req.user, id, file, category);
    await this.notifier?.toAdmins(id);
    return result;
  }

  @Get(':id/evidence/:evidenceId/download')
  download(
    @Req() req: any,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ) {
    return this.evidence.download(req.user, id, evidenceId);
  }
}
