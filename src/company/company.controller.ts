import { Controller, Patch, Param, Get } from '@nestjs/common';
import { CompanyService } from './company.service';

@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Patch(':id/verify')
  verifyCompany(@Param('id') id: string) {
    return this.companyService.verifyCompany(id);
  }
  @Get(':id/public')
getPublicSellerProfile(@Param('id') id: string) {
  return this.companyService.getPublicSellerProfile(id);
}
}