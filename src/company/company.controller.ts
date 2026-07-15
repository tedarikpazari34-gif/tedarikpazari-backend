import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';

import { CompanyService } from './company.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch(':id/verify')
  verifyCompany(@Param('id') id: string) {
    return this.companyService.verifyCompany(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMine(@Req() req: any) {
    return this.companyService.getMine(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMine(
    @Req() req: any,
    @Body() body: UpdateCompanyProfileDto,
  ) {
    if (
      req.user.role !== Role.SELLER &&
      req.user.role !== Role.BUYER &&
      req.user.role !== Role.LOGISTICS
    ) {
      return this.companyService.getMine(req.user);
    }

    return this.companyService.updateMine(req.user, body);
  }

  @Get('homepage')
  getHomepageData() {
    return this.companyService.getHomepageData();
  }

  @Get(':id/public')
  getPublicSellerProfile(@Param('id') id: string) {
    return this.companyService.getPublicSellerProfile(id);
  }
}
