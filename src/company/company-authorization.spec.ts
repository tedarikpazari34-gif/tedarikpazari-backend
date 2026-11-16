import { ForbiddenException } from '@nestjs/common';
import { CompanyService } from './company.service';

describe('Company authorization security', () => {
  it('rejects company updates without a company identity', async () => {
    const prisma = {
      company: { findUnique: jest.fn(), update: jest.fn() },
    };
    const service = new CompanyService(prisma as any, {} as any);

    await expect(
      service.updateMine({ role: 'SELLER' }, {} as any),
    ).rejects.toThrow('Firma bilgisi bulunamadı');

    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('must reject company updates by a company employee without management permission', async () => {
    const prisma = {
      company: { findUnique: jest.fn(), update: jest.fn() },
    };
    prisma.company.findUnique.mockResolvedValue({
      id: 'company-1',
      country: 'Türkiye',
      address: { companyType: 'Limited' },
      taxNumber: '1234567890',
    });

    const service = new CompanyService(
      prisma as any,
      { decrypt: jest.fn().mockReturnValue('') } as any,
    );

    await expect(
      service.updateMine(
        {
          id: 'employee-1',
          role: 'SELLER',
          companyId: 'company-1',
          companyAccess: 'EMPLOYEE',
          permissions: [],
        },
        { description: 'Unauthorized change' } as any,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.company.update).not.toHaveBeenCalled();
  });
});
