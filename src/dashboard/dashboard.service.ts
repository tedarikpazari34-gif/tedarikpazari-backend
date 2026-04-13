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
}
