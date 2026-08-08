import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { VerificationService } from './verification.service';

@ApiTags('Verification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly verificationService: VerificationService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Create company verification request',
  })
  createRequest(
    @Req() req: any,
    @Body()
    body: {
      documentUrl: string;
      documentType?: string;
      fileName?: string;
      publicId?: string;
      note?: string;
    },
  ) {
    return this.verificationService.createRequest(
      req.user.companyId,
      body,
    );
  }

  @Get('mine')
  @ApiOperation({
    summary: 'List own company verification requests',
  })
  myRequests(@Req() req: any) {
    return this.verificationService.myRequests(
      req.user.companyId,
    );
  }
}
