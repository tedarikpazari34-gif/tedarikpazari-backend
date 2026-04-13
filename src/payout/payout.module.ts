import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PayoutService } from './payout.service';
import { PayoutController } from './payout.controller';

@Module({
  imports: [PrismaModule],
  providers: [PayoutService],
  controllers: [PayoutController],
})
export class PayoutModule {}