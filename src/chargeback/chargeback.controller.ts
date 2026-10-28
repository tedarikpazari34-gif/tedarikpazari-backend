import {
  Body,
  Controller,
  Optional,
  Get,
  Post,
  Patch,
  Param,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { ChargebackService } from './chargeback.service';
import { ChargebackNotifier } from './chargeback-notifier.service';
import { ChargebackEvidenceService } from './chargeback-evidence.service';
import { CreateChargebackDto } from './create-chargeback.dto';
import { ChangeChargebackStatusDto } from './change-chargeback-status.dto';
import { UpdateChargebackDeadlineDto } from './update-chargeback-deadline.dto';

@ApiTags('Chargeback')
@ApiBearerAuth()
@Controller('admin/chargebacks')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ChargebackController {
  constructor(
    private readonly service: ChargebackService,
    private readonly evidence: ChargebackEvidenceService,
    @Optional() private readonly notifier?: ChargebackNotifier,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  async create(@Req() req: any, @Body() body: CreateChargebackDto) {
    const result = await this.service.create(req.user, body);
    await this.notifier?.toSeller(result.id, 'CREATED');
    return result;
  }


  @Patch(':id/deadline')
  async updateResponseDeadline(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateChargebackDeadlineDto,
  ) {
    const result = await this.service.updateResponseDeadline(
      req.user,
      id,
      body.responseDueAt,
      body.note,
    );

    if (!result.unchanged) {
      await this.notifier?.toSeller(id, 'STATUS_CHANGED');
    }

    return result;
  }

  @Patch(':id/status')
  async changeStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: ChangeChargebackStatusDto,
  ) {
    const result = body.nextStatus === 'EVIDENCE_SUBMITTED'
      ? await this.service.changeStatus(
          req.user,
          id,
          body.expectedStatus,
          body.nextStatus,
          body.note,
          body.bankDecisionReference,
          body.iyzicoSubmissionReference,
          body.iyzicoSubmissionAt,
        )
      : await this.service.changeStatus(
          req.user,
          id,
          body.expectedStatus,
          body.nextStatus,
          body.note,
          body.bankDecisionReference,
        );
    await this.notifier?.toSeller(id, 'STATUS_CHANGED');
    return result;
  }

  @Post(':id/evidence')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  }))
  async uploadEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('category') category: string,
  ) {
    const result = await this.evidence.add(req.user, id, file, category);
    await this.notifier?.toSeller(id, 'ADMIN_EVIDENCE');
    return result;
  }

  @Get(':id/evidence/:evidenceId/download')
  downloadEvidence(
    @Req() req: any,
    @Param('id') id: string,
    @Param('evidenceId') evidenceId: string,
  ) {
    return this.evidence.getDownload(req.user, id, evidenceId);
  }
}
