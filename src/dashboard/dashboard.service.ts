import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  async sellerDashboard(companyId: string) {
    const orders = await this.prisma.order.findMany({
      where: { sellerId: companyId },
    });

    const totalSales = orders.reduce(
      (sum, o) => sum + Number(o.totalAmount),
      0,
    );

    const totalPayout = orders.reduce(
      (sum, o) => sum + Number(o.payoutAmount),
      0,
    );

    const activeOrders = orders.filter(
      (o) =>
        o.status === OrderStatus.PAID ||
        o.status === OrderStatus.PREPARING ||
        o.status === OrderStatus.SHIPPED,
    ).length;

    const completedOrders = orders.filter(
      (o) => o.status === OrderStatus.COMPLETED,
    ).length;
    

    return {
      totalSales,
      totalPayout,
      activeOrders,
      completedOrders,
    };
  }
  async adminDashboard() {
  const [
    totalUsers,
    totalCompanies,
    approvedCompanies,
    pendingCompanies,
    totalProducts,
    approvedProducts,
    pendingProducts,
    totalOrders,
    completedOrders,
    disputes,
    openRfqs,
    quotes,
  ] = await Promise.all([
    this.prisma.user.count(),
    this.prisma.company.count(),
    this.prisma.company.count({ where: { status: 'APPROVED' } }),
    this.prisma.company.count({ where: { status: 'PENDING' } }),
    this.prisma.product.count(),
    this.prisma.product.count({ where: { isApproved: true } }),
    this.prisma.product.count({ where: { isApproved: false } }),
    this.prisma.order.count(),
    this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
    this.prisma.dispute.count(),
    this.prisma.rFQ.count({ where: { status: 'OPEN' } }),
    this.prisma.quote.count(),
  ]);

  const orders = await this.prisma.order.findMany();

  const gmv = orders.reduce(
    (sum, order) => sum + Number(order.totalAmount),
    0,
  );

  const commission = orders.reduce(
    (sum, order) => sum + Number(order.commissionAmount),
    0,
  );
  const pendingOrders = orders.filter(
  (o) => o.status === OrderStatus.PENDING_PAYMENT,
).length;

  return {
    totalUsers,
    totalCompanies,
    approvedCompanies,
    pendingCompanies,
    totalProducts,
    approvedProducts,
    pendingProducts,
    totalOrders,
    completedOrders,
    pendingOrders,
    disputes,
    openRfqs,
    quotes,
    gmv,
    commission,
    
  };
}
}
