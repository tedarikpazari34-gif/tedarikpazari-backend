import { Module } from '@nestjs/common';
import { SellerController } from './seller.controller';
import { SellerService } from './seller.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [SellerController],
  providers: [SellerService, PrismaService],
})
export class SellerModule {}
