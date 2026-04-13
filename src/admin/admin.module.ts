import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

import { AdminMetricsController } from './admin-metrics.controller';
import { AdminMetricsService } from './admin-metrics.service';

import { AdminFinanceController } from './admin-finance.controller';
import { AdminFinanceService } from './admin-finance.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminController,
    AdminMetricsController,
    AdminFinanceController,
  ],
  providers: [
    AdminService,
    AdminMetricsService,
    AdminFinanceService,
  ],
})
export class AdminModule {}