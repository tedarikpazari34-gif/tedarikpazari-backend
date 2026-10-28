import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { WalletService } from './wallet.service';

describe('Wallet financial safety', () => {
  it('admin manuel bakiye artıramaz', async () => {
    const prisma: any = {
      company: { findUnique: jest.fn() },
      companyWallet: { upsert: jest.fn(), update: jest.fn() },
      ledgerEntry: { create: jest.fn() },
      $transaction: jest.fn(),
    };

    const service = new WalletService(prisma);

    await expect(
      service.adminAdjust(
        { role: Role.ADMIN },
        'seller-company',
        100,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.companyWallet.update).not.toHaveBeenCalled();
    expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
  });

  it('satıcı cüzdanını görüntülemeye devam edebilir', async () => {
    const wallet = {
      companyId: 'seller-company',
      available: '90.00',
      locked: '0.00',
    };
    const prisma: any = {
      companyWallet: {
        upsert: jest.fn().mockResolvedValue(wallet),
      },
    };

    const service = new WalletService(prisma);

    await expect(
      service.getMine({ companyId: 'seller-company' }),
    ).resolves.toEqual({ wallet });
  });
});
