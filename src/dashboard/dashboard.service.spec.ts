import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DashboardService],
    })
      .useMocker((token) =>
        typeof token === 'function' ? {} : undefined,
      )
      .compile();

    service = module.get<DashboardService>(DashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const mockSellerPrisma = (orders: any[]) => ({
    product: { count: jest.fn().mockResolvedValue(0) },
    rFQ: { count: jest.fn().mockResolvedValue(0) },
    quote: { count: jest.fn().mockResolvedValue(0) },
    order: { findMany: jest.fn().mockResolvedValue(orders) },
    companyWallet: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  });

  const transaction = (extra: Record<string, any> = {}) => ({
    status: 'SUCCESS',
    iyzicoApprovedAt: null,
    iyzicoApprovalPendingAt: null,
    iyzicoRefundPendingAt: null,
    iyzicoRefundedAt: null,
    iyzicoRefundedAmount: '0.00',
    ...extra,
  });

  it('bekleyen ve iyzico onaylı hakedişleri ayırır', async () => {
    const prisma = mockSellerPrisma([
      {
        id: 'pending',
        status: 'PAID',
        totalAmount: '100.00',
        payoutAmount: '90.00',
        paymentTransactions: [transaction()],
      },
      {
        id: 'approved',
        status: 'COMPLETED',
        totalAmount: '200.00',
        payoutAmount: '180.00',
        paymentTransactions: [
          transaction({
            iyzicoApprovedAt: new Date('2026-10-19'),
          }),
        ],
      },
    ]);

    const dashboard = new DashboardService(prisma as any);
    const result = await dashboard.sellerDashboard({
      role: 'SELLER',
      companyId: 'seller-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        pendingIyzicoPayout: '90.00',
        approvedIyzicoPayout: '180.00',
      }),
    );
  });

  it('iade ve iptal işlemlerini hakedişe eklemez', async () => {
    const prisma = mockSellerPrisma([
      {
        id: 'refund-pending',
        status: 'PAID',
        totalAmount: '100.00',
        payoutAmount: '90.00',
        paymentTransactions: [
          transaction({
            iyzicoRefundPendingAt: new Date('2026-10-19'),
          }),
        ],
      },
      {
        id: 'cancelled',
        status: 'CANCELLED',
        totalAmount: '200.00',
        payoutAmount: '180.00',
        paymentTransactions: [
          transaction({
            iyzicoApprovedAt: new Date('2026-10-19'),
          }),
        ],
      },
      {
        id: 'unverified',
        status: 'PAID',
        totalAmount: '50.00',
        payoutAmount: '45.00',
        paymentTransactions: [],
      },
    ]);

    const dashboard = new DashboardService(prisma as any);
    const result = await dashboard.sellerDashboard({
      role: 'SELLER',
      companyId: 'seller-1',
    });

    expect(result).toEqual(
      expect.objectContaining({
        pendingIyzicoPayout: '0.00',
        approvedIyzicoPayout: '0.00',
      }),
    );
  });
});
