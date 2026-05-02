import { Module } from '@nestjs/common';
import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [ShippingController],
  providers: [ShippingService, PrismaService],
})
export class ShippingModule {}