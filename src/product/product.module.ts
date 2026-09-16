import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [ProductController],
  providers: [ProductService, PrismaService],
})
export class ProductModule {}
