import { Test, TestingModule } from '@nestjs/testing';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ProductImportService } from './product-import.service';
import { ProductXmlFeedService } from './product-xml-feed.service';

describe('ProductController', () => {
  let controller: ProductController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductController],
      providers: [
        { provide: ProductService, useValue: {} },
        { provide: ProductImportService, useValue: {} },
        { provide: ProductXmlFeedService, useValue: {} },
      ],
    })
      .useMocker((token) =>
        typeof token === 'function' ? {} : undefined,
      )
      .compile();

    controller = module.get<ProductController>(ProductController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
