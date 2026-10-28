import { ChargebackDeadlineService } from './chargeback-deadline.service';
import { SellerChargebackEvidenceService } from './seller-chargeback-evidence.service';
import { SellerChargebackEvidenceController } from './seller-chargeback-evidence.controller';
import { ChargebackReadService } from './chargeback-read.service';
import { ChargebackReadController, SellerChargebackController } from './chargeback-read.controller';
import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ChargebackNotifier } from './chargeback-notifier.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ChargebackController } from './chargeback.controller';
import { ChargebackService } from './chargeback.service';
import { ChargebackEvidenceService } from './chargeback-evidence.service';
import { ChargebackStorageService } from './chargeback-storage.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [SellerChargebackEvidenceController, ChargebackReadController, SellerChargebackController, ChargebackController],
  providers: [ChargebackDeadlineService, ChargebackNotifier, SellerChargebackEvidenceService, ChargebackReadService, ChargebackService, ChargebackEvidenceService, ChargebackStorageService],
})
export class ChargebackModule {}
