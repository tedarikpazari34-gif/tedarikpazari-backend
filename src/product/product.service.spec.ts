import { Test, TestingModule } from '@nestjs/testing';
import { ProductService } from './product.service';
import { PrismaService } from '../prisma.service';
import { AiService } from '../ai/ai.service';
import { ProductCatalogService } from './product-catalog.service';
import { ProductRevisionService } from './product-revision.service';


describe('ProductService', () => {
  let service: ProductService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: {} },
        { provide: AiService, useValue: {} },
        { provide: ProductCatalogService, useValue: {} },
        { provide: ProductRevisionService, useValue: {} },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
