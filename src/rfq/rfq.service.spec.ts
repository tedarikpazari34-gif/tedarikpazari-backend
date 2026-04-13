import { Test, TestingModule } from '@nestjs/testing';
import { RfqService } from './rfq.service';

describe('RfqService', () => {
  let service: RfqService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RfqService],
    }).compile();

    service = module.get<RfqService>(RfqService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
