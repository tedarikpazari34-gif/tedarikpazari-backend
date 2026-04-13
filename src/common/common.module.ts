import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CompanyStatusGuard } from './company-status/company-status.guard';

@Module({
  imports: [PrismaModule],
  providers: [CompanyStatusGuard],
  exports: [CompanyStatusGuard],
})
export class CommonModule {}