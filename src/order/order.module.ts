import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],   // 🔴 BU SATIR ŞART
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}