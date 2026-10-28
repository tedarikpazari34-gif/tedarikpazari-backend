import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PayoutService } from './payout.service';

describe('PayoutService', () => {
  let service: PayoutService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PayoutService],
    })
      .useMocker((token) =>
        typeof token === 'function' ? {} : undefined,
      )
      .compile();

    service = module.get<PayoutService>(PayoutService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('satıcı manuel para çekme talebi oluşturamaz', async () => {
    await expect(
      service.request(
        { role: 'SELLER', companyId: 'seller-1' },
        { amount: 100, iban: 'TR123456789012345678901234' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('admin manuel para çekme talebini onaylayamaz', async () => {
    await expect(
      service.approve({ role: 'ADMIN' }, 'payout-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('admin manuel para çekme talebini reddedemez', async () => {
    await expect(
      service.reject({ role: 'ADMIN' }, 'payout-1'),
    ).rejects.toThrow(ForbiddenException);
  });
});
