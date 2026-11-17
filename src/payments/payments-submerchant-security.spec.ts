import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CompanyStatus, Role } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('iyzico submerchant onboarding and reconciliation security', () => {
  let service: PaymentsService;
  let company: any;
  let prisma: any;
  let iyzico: any;
  let notificationService: any;

  const seller = { id: 'seller-user', role: Role.SELLER };
  const admin = { id: 'admin-user', role: Role.ADMIN };
  const iban = 'TR330006100519786457841326';

  beforeEach(() => {
    company = {
      id: 'seller-company',
      role: Role.SELLER,
      status: CompanyStatus.APPROVED,
      verified: true,
      country: 'Türkiye',
      name: 'Test Limited',
      email: 'test@example.invalid',
      phone: '05000000000',
      taxOffice: 'Test Vergi Dairesi',
      taxNumber: '1234567890',
      city: 'İstanbul',
      paymentIdentityNumber: null,
      iyzicoSubMerchantKey: null,
      iyzicoSubMerchantPendingAt: null,
      address: {
        companyType: 'Limited',
        address: 'Test Sokak',
        district: 'Test İlçe',
        fullName: 'Test Yetkili',
      },
    };

    prisma = {
      user: {
        findMany: jest.fn().mockImplementation(async ({ where }: any) =>
          where.role === Role.ADMIN
            ? [{ id: 'admin-user' }]
            : [{ id: 'seller-user' }],
        ),
        findUnique: jest.fn().mockImplementation(async () => ({
          id: seller.id,
          emailVerified: true,
          company,
        })),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    iyzico = {
      createSubMerchant: jest.fn().mockResolvedValue({
        status: 'success',
        subMerchantKey: 'mock-merchant-key',
      }),
      retrieveSubMerchant: jest.fn().mockResolvedValue({
        status: 'success',
        subMerchantExternalId: company.id,
        subMerchantKey: 'mock-merchant-key',
      }),
    };

    notificationService = {
      createNotification: jest.fn().mockResolvedValue({
        id: 'mock-notification',
      }),
    };

    service = Object.create(PaymentsService.prototype);
    Object.assign(service, {
      prisma,
      iyzico,
      notificationService,
      sensitiveData: { decrypt: jest.fn().mockReturnValue(null) },
    });
  });

  it.each([Role.BUYER, Role.ADMIN])(
    'rejects onboarding for role %s',
    async role => {
      await expect(
        service.createIyzicoSubMerchant({ id: 'u', role }, { iban }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(iyzico.createSubMerchant).not.toHaveBeenCalled();
    },
  );

  it('rejects a missing seller company', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(iyzico.createSubMerchant).not.toHaveBeenCalled();
  });

  it('requires verified email', async () => {
    prisma.user.findUnique.mockResolvedValue({
      emailVerified: false,
      company,
    });
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires approved company', async () => {
    company.status = CompanyStatus.PENDING;
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires verified company', async () => {
    company.verified = false;
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects already registered company', async () => {
    company.iyzicoSubMerchantKey = 'existing-key';
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(iyzico.createSubMerchant).not.toHaveBeenCalled();
  });

  it('rejects seller user linked to a buyer company', async () => {
    company.role = Role.BUYER;

    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(iyzico.createSubMerchant).not.toHaveBeenCalled();
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });

  it('rejects structurally valid IBAN with wrong checksum', async () => {
    await expect(
      service.createIyzicoSubMerchant(seller, {
        iban: 'TR330006100519786457841327',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(iyzico.createSubMerchant).not.toHaveBeenCalled();
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });

  it('rejects foreign-company onboarding', async () => {
    company.country = 'Germany';
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed IBAN', async () => {
    await expect(
      service.createIyzicoSubMerchant(seller, { iban: 'TR123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not contact iyzico when claim is already taken', async () => {
    prisma.company.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(iyzico.createSubMerchant).not.toHaveBeenCalled();
  });

  it('keeps unresolved provider failure pending for reconciliation', async () => {
    iyzico.createSubMerchant.mockResolvedValue({ status: 'failure' });
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.company.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not retry on provider exception', async () => {
    iyzico.createSubMerchant.mockRejectedValue(new Error('mock timeout'));
    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toThrow('mock timeout');
    expect(iyzico.createSubMerchant).toHaveBeenCalledTimes(1);
    expect(prisma.company.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects failed local finalization without retry', async () => {
    prisma.company.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      service.createIyzicoSubMerchant(seller, { iban }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(iyzico.createSubMerchant).toHaveBeenCalledTimes(1);
  });

  it('creates provider record only after atomic claim', async () => {
    const result = await service.createIyzicoSubMerchant(seller, { iban });
    expect(result.success).toBe(true);
    expect(iyzico.createSubMerchant).toHaveBeenCalledWith(
      expect.objectContaining({
        subMerchantExternalId: company.id,
        subMerchantType: 'LIMITED_OR_JOINT_STOCK_COMPANY',
        iban,
      }),
    );
    expect(prisma.company.updateMany).toHaveBeenCalledTimes(2);
  });

  it('restricts reconciliation to admin', async () => {
    await expect(
      service.reconcileIyzicoSubMerchant(seller, company.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(iyzico.retrieveSubMerchant).not.toHaveBeenCalled();
  });

  it('rejects reconciliation for missing company', async () => {
    await expect(
      service.reconcileIyzicoSubMerchant(admin, company.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects reconciliation for buyer company', async () => {
    prisma.company.findUnique.mockResolvedValue({
      ...company,
      role: Role.BUYER,
    });
    await expect(
      service.reconcileIyzicoSubMerchant(admin, company.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns idempotent completion for existing merchant', async () => {
    prisma.company.findUnique.mockResolvedValue({
      ...company,
      iyzicoSubMerchantKey: 'existing-key',
    });
    const result = await service.reconcileIyzicoSubMerchant(
      admin, company.id,
    );
    expect(result.alreadyCompleted).toBe(true);
    expect(iyzico.retrieveSubMerchant).not.toHaveBeenCalled();
  });

  it('requires pending claim before reconciliation', async () => {
    prisma.company.findUnique.mockResolvedValue(company);
    await expect(
      service.reconcileIyzicoSubMerchant(admin, company.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects mismatched provider company identity', async () => {
    prisma.company.findUnique.mockResolvedValue({
      ...company,
      iyzicoSubMerchantPendingAt: new Date(),
    });
    iyzico.retrieveSubMerchant.mockResolvedValue({
      status: 'success',
      subMerchantExternalId: 'another-company',
      subMerchantKey: 'mock-merchant-key',
    });
    await expect(
      service.reconcileIyzicoSubMerchant(admin, company.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.company.updateMany).not.toHaveBeenCalled();
  });

  it('rejects provider response without merchant key', async () => {
    prisma.company.findUnique.mockResolvedValue({
      ...company,
      iyzicoSubMerchantPendingAt: new Date(),
    });
    iyzico.retrieveSubMerchant.mockResolvedValue({
      status: 'success',
      subMerchantExternalId: company.id,
    });
    await expect(
      service.reconcileIyzicoSubMerchant(admin, company.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects reconciliation finalization race', async () => {
    prisma.company.findUnique.mockResolvedValue({
      ...company,
      iyzicoSubMerchantPendingAt: new Date(),
    });
    prisma.company.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.reconcileIyzicoSubMerchant(admin, company.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('completes verified admin reconciliation safely', async () => {
    prisma.company.findUnique.mockResolvedValue({
      ...company,
      iyzicoSubMerchantPendingAt: new Date(),
    });
    const result = await service.reconcileIyzicoSubMerchant(
      admin, company.id,
    );
    expect(result).toEqual(expect.objectContaining({
      success: true,
      alreadyCompleted: false,
    }));
    expect(prisma.company.updateMany).toHaveBeenCalledTimes(1);
  });


  describe('iyzico notification idempotency regression', () => {
    it('does not notify again after an unsuccessful repeated claim', async () => {
      prisma.company.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      iyzico.createSubMerchant.mockResolvedValue({ status: 'failure' });

      await expect(
        service.createIyzicoSubMerchant(seller, { iban }),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.createIyzicoSubMerchant(seller, { iban }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(iyzico.createSubMerchant).toHaveBeenCalledTimes(1);
      expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
    });

    it('does not notify for already completed reconciliation', async () => {
      prisma.company.findUnique.mockResolvedValue({
        ...company,
        iyzicoSubMerchantKey: 'existing-key',
      });

      const result = await service.reconcileIyzicoSubMerchant(
        admin, company.id,
      );

      expect(result.alreadyCompleted).toBe(true);
      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });

    it('does not notify after a reconciliation update collision', async () => {
      prisma.company.findUnique.mockResolvedValue({
        ...company,
        iyzicoSubMerchantPendingAt: new Date(),
      });
      prisma.company.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reconcileIyzicoSubMerchant(admin, company.id),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });

    it('keeps successful reconciliation when notification delivery fails', async () => {
      prisma.company.findUnique.mockResolvedValue({
        ...company,
        iyzicoSubMerchantPendingAt: new Date(),
      });
      notificationService.createNotification.mockRejectedValue(
        new Error('mock notification failure'),
      );

      const result = await service.reconcileIyzicoSubMerchant(
        admin, company.id,
      );

      expect(result.success).toBe(true);
      expect(result.alreadyCompleted).toBe(false);
      expect(prisma.company.updateMany).toHaveBeenCalledTimes(1);
      expect(notificationService.createNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('iyzico notification delivery security', () => {
    it('notifies seller and admin after successful onboarding', async () => {
      const result = await service.createIyzicoSubMerchant(
        seller, { iban },
      );

      expect(result.success).toBe(true);
      expect(notificationService.createNotification).toHaveBeenCalledTimes(2);

      const payloads = notificationService.createNotification.mock.calls
        .map(([data]: any[]) => data);

      expect(payloads.map((data: any) => data.userId).sort())
        .toEqual(['admin-user', 'seller-user']);

      for (const data of payloads) {
        expect(data.type).toBe('COMPANY');
        expect(JSON.stringify(data)).not.toContain(iban);
        expect(JSON.stringify(data)).not.toContain('mock-merchant-key');
        expect(JSON.stringify(data)).not.toContain(company.taxNumber);
      }
    });

    it('notifies pending state after provider failure', async () => {
      iyzico.createSubMerchant.mockResolvedValue({
        status: 'failure',
      });

      await expect(
        service.createIyzicoSubMerchant(seller, { iban }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(notificationService.createNotification)
        .toHaveBeenCalledTimes(2);
      expect(notificationService.createNotification.mock.calls[0][0].message)
        .toContain('kontrol bekliyor');
    });

    it('notifies pending state after provider exception', async () => {
      iyzico.createSubMerchant.mockRejectedValue(
        new Error('mock provider timeout'),
      );

      await expect(
        service.createIyzicoSubMerchant(seller, { iban }),
      ).rejects.toThrow('mock provider timeout');

      expect(iyzico.createSubMerchant).toHaveBeenCalledTimes(1);
      expect(notificationService.createNotification)
        .toHaveBeenCalledTimes(2);
    });

    it('notifies seller and admin after verified reconciliation', async () => {
      prisma.company.findUnique.mockResolvedValue({
        ...company,
        iyzicoSubMerchantPendingAt: new Date(),
      });

      const result = await service.reconcileIyzicoSubMerchant(
        admin, company.id,
      );

      expect(result.success).toBe(true);
      expect(result.alreadyCompleted).toBe(false);
      expect(notificationService.createNotification)
        .toHaveBeenCalledTimes(2);
    });

    it('does not notify when onboarding claim is already taken', async () => {
      prisma.company.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.createIyzicoSubMerchant(seller, { iban }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(notificationService.createNotification).not.toHaveBeenCalled();
    });

    it('does not undo successful onboarding on notification failure', async () => {
      notificationService.createNotification.mockRejectedValue(
        new Error('mock notification failure'),
      );

      const result = await service.createIyzicoSubMerchant(
        seller, { iban },
      );

      expect(result.success).toBe(true);
      expect(prisma.company.updateMany).toHaveBeenCalledTimes(2);
      expect(notificationService.createNotification)
        .toHaveBeenCalledTimes(2);
    });
  });

});
