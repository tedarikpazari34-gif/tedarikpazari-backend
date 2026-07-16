import { ForbiddenException, Injectable } from '@nestjs/common';

import {
  CompanyStatus,
  OrderStatus,
  Role,
  ShippingOrderStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

const REVENUE_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PREPARING,
  OrderStatus.SHIPPED,
  OrderStatus.COMPLETED,
];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private requireRole(user: any, expectedRole: Role) {
    if (!user || user.role !== expectedRole) {
      throw new ForbiddenException(
        `Bu dashboard yalnızca ${expectedRole} rolüne açıktır`,
      );
    }
  }

  async buyerDashboard(user: any) {
    this.requireRole(user, Role.BUYER);

    const companyId = user.companyId;

    const [rfqs, quoteCount, orders, shippingRfqCount, shippingOrders] =
      await Promise.all([
        this.prisma.rFQ.findMany({
          where: { buyerId: companyId },
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),

        this.prisma.quote.count({
          where: {
            rfq: {
              buyerId: companyId,
            },
          },
        }),

        this.prisma.order.findMany({
          where: { buyerId: companyId },
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),

        this.prisma.shippingRFQ.count({
          where: { buyerId: companyId },
        }),

        this.prisma.shippingOrder.findMany({
          where: { buyerId: companyId },
          select: {
            id: true,
            status: true,
            trackingNo: true,
            shippingCompany: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

    const totalPurchases = orders
      .filter((order) => REVENUE_STATUSES.includes(order.status))
      .reduce((sum, order) => sum + Number(order.totalAmount), 0);

    return {
      openRfqs: rfqs.filter((rfq) => rfq.status === 'OPEN').length,
      closedRfqs: rfqs.filter((rfq) => rfq.status === 'CLOSED').length,
      totalRfqs: rfqs.length,
      receivedQuotes: quoteCount,

      pendingPaymentOrders: orders.filter(
        (order) => order.status === OrderStatus.PENDING_PAYMENT,
      ).length,

      activeOrders: orders.filter(
        (order) =>
          order.status === OrderStatus.PAID ||
          order.status === OrderStatus.PREPARING ||
          order.status === OrderStatus.SHIPPED,
      ).length,

      completedOrders: orders.filter(
        (order) => order.status === OrderStatus.COMPLETED,
      ).length,

      totalOrders: orders.length,
      totalPurchases,

      shippingRequests: shippingRfqCount,

      activeShippingOrders: shippingOrders.filter(
        (order) => order.status !== ShippingOrderStatus.DELIVERED,
      ).length,

      completedShippingOrders: shippingOrders.filter(
        (order) => order.status === ShippingOrderStatus.DELIVERED,
      ).length,

      recentOrders: orders.slice(0, 5),
      recentShippingOrders: shippingOrders.slice(0, 5),
    };
  }

  async sellerDashboard(user: any) {
    this.requireRole(user, Role.SELLER);

    const companyId = user.companyId;

    const [
      activeProducts,
      totalProducts,
      openRfqs,
      sentQuotes,
      orders,
      wallet,
    ] = await Promise.all([
      this.prisma.product.count({
        where: {
          sellerId: companyId,
          isActive: true,
          isApproved: true,
        },
      }),

      this.prisma.product.count({
        where: { sellerId: companyId },
      }),

      this.prisma.rFQ.count({
        where: {
          status: 'OPEN',
          product: {
            sellerId: companyId,
          },
        },
      }),

      this.prisma.quote.count({
        where: { sellerId: companyId },
      }),

      this.prisma.order.findMany({
        where: { sellerId: companyId },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          payoutAmount: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.companyWallet.findUnique({
        where: { companyId },
        select: {
          available: true,
          locked: true,
        },
      }),
    ]);

    const revenueOrders = orders.filter((order) =>
      REVENUE_STATUSES.includes(order.status),
    );

    const grossSales = revenueOrders.reduce(
      (sum, order) => sum + Number(order.totalAmount),
      0,
    );

    const totalPayout = revenueOrders.reduce(
      (sum, order) => sum + Number(order.payoutAmount),
      0,
    );

    return {
      activeProducts,
      totalProducts,
      openRfqs,
      sentQuotes,

      activeOrders: orders.filter(
        (order) =>
          order.status === OrderStatus.PAID ||
          order.status === OrderStatus.PREPARING ||
          order.status === OrderStatus.SHIPPED,
      ).length,

      completedOrders: orders.filter(
        (order) => order.status === OrderStatus.COMPLETED,
      ).length,

      totalOrders: orders.length,
      grossSales,
      totalPayout,

      walletAvailable: Number(wallet?.available || 0),
      walletLocked: Number(wallet?.locked || 0),

      recentOrders: orders.slice(0, 5),
    };
  }

  async logisticsDashboard(user: any) {
    this.requireRole(user, Role.LOGISTICS);

    const companyId = user.companyId;

    const [openShippingRfqs, quotes, shippingOrders] = await Promise.all([
      this.prisma.shippingRFQ.count({
        where: { status: 'OPEN' },
      }),

      this.prisma.shippingQuote.findMany({
        where: { companyId },
        select: {
          id: true,
          status: true,
          price: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.shippingOrder.findMany({
        where: { logisticsId: companyId },
        select: {
          id: true,
          status: true,
          trackingNo: true,
          shippingCompany: true,
          createdAt: true,
          shippingQuote: {
            select: {
              price: true,
            },
          },
          shippingRfq: {
            select: {
              fromAddress: true,
              toAddress: true,
            },
          },
          order: {
            select: {
              rfq: {
                select: {
                  product: {
                    select: {
                      title: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const grossTransportAmount = shippingOrders.reduce(
      (sum, order) => sum + Number(order.shippingQuote?.price || 0),
      0,
    );

    return {
      openShippingRfqs,
      submittedQuotes: quotes.length,
      acceptedQuotes: quotes.filter((quote) => quote.status === 'ACCEPTED')
        .length,

      pendingPickup: shippingOrders.filter(
        (order) => order.status === ShippingOrderStatus.PENDING_PICKUP,
      ).length,

      pickedUp: shippingOrders.filter(
        (order) => order.status === ShippingOrderStatus.PICKED_UP,
      ).length,

      inTransit: shippingOrders.filter(
        (order) => order.status === ShippingOrderStatus.IN_TRANSIT,
      ).length,

      activeShippingOrders: shippingOrders.filter(
        (order) => order.status !== ShippingOrderStatus.DELIVERED,
      ).length,

      completedShippingOrders: shippingOrders.filter(
        (order) => order.status === ShippingOrderStatus.DELIVERED,
      ).length,

      totalShippingOrders: shippingOrders.length,
      grossTransportAmount,

      recentShippingOrders: shippingOrders.slice(0, 5),
    };
  }

  async adminDashboard(user: any) {
    this.requireRole(user, Role.ADMIN);

    const [
      totalUsers,
      totalCompanies,
      approvedCompanies,
      pendingCompanies,
      blockedCompanies,
      totalProducts,
      activeProducts,
      inactiveProducts,
      totalOrders,
      completedOrders,
      pendingOrders,
      disputes,
      openRfqs,
      quotes,
      openShippingRfqs,
      totalShippingOrders,
      completedShippingOrders,
      orders,
    ] = await Promise.all([
      this.prisma.user.count(),

      this.prisma.company.count(),

      this.prisma.company.count({
        where: { status: CompanyStatus.APPROVED },
      }),

      this.prisma.company.count({
        where: { status: CompanyStatus.PENDING },
      }),

      this.prisma.company.count({
        where: { status: CompanyStatus.BLOCKED },
      }),

      this.prisma.product.count(),

      this.prisma.product.count({
        where: {
          isActive: true,
          isApproved: true,
        },
      }),

      this.prisma.product.count({
        where: {
          OR: [{ isActive: false }, { isApproved: false }],
        },
      }),

      this.prisma.order.count(),

      this.prisma.order.count({
        where: { status: OrderStatus.COMPLETED },
      }),

      this.prisma.order.count({
        where: { status: OrderStatus.PENDING_PAYMENT },
      }),

      this.prisma.dispute.count(),

      this.prisma.rFQ.count({
        where: { status: 'OPEN' },
      }),

      this.prisma.quote.count(),

      this.prisma.shippingRFQ.count({
        where: { status: 'OPEN' },
      }),

      this.prisma.shippingOrder.count(),

      this.prisma.shippingOrder.count({
        where: { status: ShippingOrderStatus.DELIVERED },
      }),

      this.prisma.order.findMany({
        select: {
          totalAmount: true,
          commissionAmount: true,
          status: true,
        },
      }),
    ]);

    const revenueOrders = orders.filter((order) =>
      REVENUE_STATUSES.includes(order.status),
    );

    const gmv = revenueOrders.reduce(
      (sum, order) => sum + Number(order.totalAmount),
      0,
    );

    const commission = revenueOrders.reduce(
      (sum, order) => sum + Number(order.commissionAmount),
      0,
    );

    return {
      totalUsers,
      totalCompanies,
      approvedCompanies,
      pendingCompanies,
      blockedCompanies,

      totalProducts,
      approvedProducts: activeProducts,
      pendingProducts: inactiveProducts,

      totalOrders,
      completedOrders,
      pendingOrders,

      disputes,
      openRfqs,
      quotes,

      openShippingRfqs,
      totalShippingOrders,
      completedShippingOrders,

      gmv,
      commission,
    };
  }
}
