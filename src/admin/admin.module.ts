import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';

import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

import { AdminMetricsController } from './admin-metrics.controller';
import { AdminMetricsService } from './admin-metrics.service';

import { AdminFinanceController } from './admin-finance.controller';
import { AdminFinanceService } from './admin-finance.service';

import { AdminControlCenterController } from './admin-control-center.controller';
import { AdminControlCenterService } from './admin-control-center.service';

@Module({
  imports: [PrismaModule, ChatModule],
  controllers: [
    AdminController,
    AdminMetricsController,
    AdminFinanceController,
    AdminControlCenterController,
  ],
  providers: [
    AdminService,
    AdminMetricsService,
    AdminFinanceService,
    AdminControlCenterService,
  ],
})
export class AdminModule {}
