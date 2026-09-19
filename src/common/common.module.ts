import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CompanyStatusGuard } from './company-status/company-status.guard';
import { SensitiveDataService } from './security/sensitive-data.service';

@Module({
  imports: [PrismaModule],
  providers: [CompanyStatusGuard, SensitiveDataService],
  exports: [CompanyStatusGuard, SensitiveDataService],
})
export class CommonModule {}