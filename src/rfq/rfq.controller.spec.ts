import { Test, TestingModule } from '@nestjs/testing';
import { RfqController } from './rfq.controller';

describe('RfqController', () => {
  let controller: RfqController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RfqController],
    }).compile();

    controller = module.get<RfqController>(RfqController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
