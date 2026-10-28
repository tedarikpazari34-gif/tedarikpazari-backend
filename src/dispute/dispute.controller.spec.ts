import { Test, TestingModule } from '@nestjs/testing';
import { DisputeController } from './dispute.controller';

describe('DisputeController', () => {
  let controller: DisputeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisputeController],
    })
      .useMocker((token) =>
        typeof token === 'function' ? {} : undefined,
      )
      .compile();

    controller = module.get<DisputeController>(DisputeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
