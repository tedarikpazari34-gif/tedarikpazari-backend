import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';

@Module({
  imports: [PrismaModule],
  controllers: [DisputeController],
  providers: [DisputeService],
})
export class DisputeModule {}