import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ProductImportService } from './product-import.service';
import { ProductCatalogService } from './product-catalog.service';
import { ProductRevisionService } from './product-revision.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  controllers: [ProductController],
  exports: [ProductRevisionService],
  providers: [ProductService, ProductImportService, ProductCatalogService, ProductRevisionService, PrismaService],
})
export class ProductModule {}
