import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerType, OrderStatus, PayoutStatus, Prisma, Role } from '@prisma/client';

@Injectable()
export class AdminMetricsService {
  constructor(private prisma: PrismaService) {}

  async overview(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN görebilir');
    }

    const [
      companiesTotal,
      companiesPending,
      companiesApproved,
      companiesBlocked,
      usersTotal,

      productsTotal,
      rfqsTotal,
      quotesTotal,

      disputesOpen,
      payoutsPending,

      ordersTotal,
      ordersPendingPayment,
      ordersPaid,
      ordersPreparing,
      ordersShipped,
      ordersCompleted,

      escrowDepositedTotal,
      commissionTotal,
      walletAvailableTotal,
      walletLockedTotal,
    ] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.count({ where: { status: 'PENDING' } as any }),
      this.prisma.company.count({ where: { status: 'APPROVED' } as any }),
      this.prisma.company.count({ where: { status: 'BLOCKED' } as any }),

      this.prisma.user.count(),

      this.prisma.product.count(),
      this.prisma.rFQ.count(),
      this.prisma.quote.count(),

      this.prisma.dispute.count({ where: { status: { in: ['OPEN', 'SELLER_RESPONDED'] } } as any }),
      this.prisma.payout.count({ where: { status: PayoutStatus.PENDING } }),

      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.PENDING_PAYMENT } }),
      this.prisma.order.count({ where: { status: OrderStatus.PAID } }),
      this.prisma.order.count({ where: { status: OrderStatus.PREPARING } }),
      this.prisma.order.count({ where: { status: OrderStatus.SHIPPED } }),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),

      // ✅ Tekilleştirme: ESCROW_DEPOSIT sadece "pay()" sırasında yazılacak (aşağıdaki kodlarla)
      this.sumLedger(LedgerType.ESCROW_DEPOSIT),
      this.sumLedger(LedgerType.COMMISSION),

      this.sumWallet('available'),
      this.sumWallet('locked'),
    ]);

    return {
      message: 'admin metrics ok',
      companies: {
        total: companiesTotal,
        pending: companiesPending,
        approved: companiesApproved,
        blocked: companiesBlocked,
      },
      users: { total: usersTotal },
      marketplace: {
        productsTotal,
        rfqsTotal,
        quotesTotal,
        disputesOpen,
        payoutsPending,
      },
      orders: {
        total: ordersTotal,
        pendingPayment: ordersPendingPayment,
        paid: ordersPaid,
        preparing: ordersPreparing,
        shipped: ordersShipped,
        completed: ordersCompleted,
      },
      finance: {
        escrowDepositedTotal,
        commissionTotal,
        walletAvailableTotal,
        walletLockedTotal,
      },
    };
  }

  async timeseries(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN görebilir');
    }

    const days = 7;
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const labels: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      labels.push(d.toISOString().slice(0, 10));
    }

    const dayKey = (dt: Date) => dt.toISOString().slice(0, 10);

    const [orders, disputes, payoutApprovedLedger] = await Promise.all([
      this.prisma.order.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true },
      }),
      this.prisma.dispute.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { createdAt: { gte: start }, type: LedgerType.PAYOUT_APPROVE },
        select: { createdAt: true, amount: true },
      }),
    ]);

    const ordersByDay: Record<string, number> = Object.fromEntries(labels.map(l => [l, 0]));
    const disputesByDay: Record<string, number> = Object.fromEntries(labels.map(l => [l, 0]));
    const payoutApproveCountByDay: Record<string, number> = Object.fromEntries(labels.map(l => [l, 0]));
    const payoutApproveSumByDay: Record<string, string> = Object.fromEntries(labels.map(l => [l, '0']));

    for (const o of orders) ordersByDay[dayKey(o.createdAt)]++;
    for (const d of disputes) disputesByDay[dayKey(d.createdAt)]++;

    for (const p of payoutApprovedLedger) {
      const k = dayKey(p.createdAt);
      payoutApproveCountByDay[k]++;

      const prev = new Prisma.Decimal(payoutApproveSumByDay[k]);
      payoutApproveSumByDay[k] = prev.add(new Prisma.Decimal(p.amount as any)).toString();
    }

    return {
      message: 'admin timeseries ok',
      range: { days, start: start.toISOString(), end: now.toISOString() },
      labels,
      series: {
        ordersCreated: labels.map(l => ordersByDay[l]),
        disputesCreated: labels.map(l => disputesByDay[l]),
        payoutApprovedCount: labels.map(l => payoutApproveCountByDay[l]),
        payoutApprovedAmount: labels.map(l => payoutApproveSumByDay[l]),
      },
    };
  }

  private async sumLedger(type: LedgerType) {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { type },
      select: { amount: true },
    });

    let total = new Prisma.Decimal(0);
    for (const r of rows) total = total.add(new Prisma.Decimal(r.amount as any));
    return total.toString();
  }

  private async sumWallet(field: 'available' | 'locked') {
    // CompanyWallet model’in sende var (migration yaptın)
    const rows = await (this.prisma as any).companyWallet.findMany({
      select: { [field]: true },
    });

    let total = new Prisma.Decimal(0);
    for (const r of rows) total = total.add(new Prisma.Decimal(r[field] as any));
    return total.toString();
  }
}