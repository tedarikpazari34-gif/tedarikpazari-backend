import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

type StockRow = {
  id: string;
  sellerId: string;
  label: string;
  stockQuantity: number | null;
  reservedQuantity: number;
  minStockThreshold: number | null;
  stockAlertActive: boolean;
  listed: boolean;
};

@Injectable()
export class StockAlertService {
  private readonly logger = new Logger(StockAlertService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkCriticalStock() {
    if (process.env.STOCK_ALERT_ENABLED !== 'true') return;
    if (this.running) return;
    this.running = true;

    try {
      await this.scan('product');
      await this.scan('variant');
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  private async scan(kind: 'product' | 'variant') {
    let cursor: string | undefined;

    while (true) {
      const page = {
        take: 100,
        orderBy: { id: 'asc' as const },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      };

      const rows: StockRow[] =
        kind === 'product'
          ? (await this.prisma.product.findMany({
              ...page,
              where: {
                OR: [
                  { minStockThreshold: { not: null } },
                  { stockAlertActive: true },
                ],
              },
              select: {
                id: true,
                sellerId: true,
                title: true,
                isActive: true,
                isApproved: true,
                stockQuantity: true,
                reservedQuantity: true,
                minStockThreshold: true,
                stockAlertActive: true,
              },
            })).map((p) => ({
              id: p.id,
              sellerId: p.sellerId,
              label: p.title,
              stockQuantity: p.stockQuantity,
              reservedQuantity: p.reservedQuantity,
              minStockThreshold: p.minStockThreshold,
              stockAlertActive: p.stockAlertActive,
              listed: p.isActive && p.isApproved,
            }))
          : (await this.prisma.productVariant.findMany({
              ...page,
              where: {
                OR: [
                  { minStockThreshold: { not: null } },
                  { stockAlertActive: true },
                ],
              },
              select: {
                id: true,
                name: true,
                isActive: true,
                stockQuantity: true,
                reservedQuantity: true,
                minStockThreshold: true,
                stockAlertActive: true,
                product: {
                  select: {
                    sellerId: true,
                    title: true,
                    isActive: true,
                    isApproved: true,
                  },
                },
              },
            })).map((v) => ({
              id: v.id,
              sellerId: v.product.sellerId,
              label: `${v.product.title} / ${v.name}`,
              stockQuantity: v.stockQuantity,
              reservedQuantity: v.reservedQuantity,
              minStockThreshold: v.minStockThreshold,
              stockAlertActive: v.stockAlertActive,
              listed:
                v.isActive &&
                v.product.isActive &&
                v.product.isApproved,
            }));

      if (rows.length === 0) break;

      for (const row of rows) {
        try {
          await this.processRow(kind, row);
        } catch (error) {
          this.logger.error(
            `Stok kontrolu ${kind}/${row.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      cursor = rows[rows.length - 1].id;
      if (rows.length < 100) break;
    }
  }

  private async processRow(
    kind: 'product' | 'variant',
    row: StockRow,
  ) {
    const available =
      row.stockQuantity === null
        ? null
        : Math.max(0, row.stockQuantity - row.reservedQuantity);

    const low =
      row.listed &&
      available !== null &&
      row.minStockThreshold !== null &&
      available <= row.minStockThreshold;

    if (low === row.stockAlertActive) return;

    const where = {
      id: row.id,
      stockQuantity: row.stockQuantity,
      reservedQuantity: row.reservedQuantity,
      minStockThreshold: row.minStockThreshold,
      stockAlertActive: row.stockAlertActive,
    };

    if (!low) {
      if (kind === 'product') {
        await this.prisma.product.updateMany({
          where,
          data: { stockAlertActive: false },
        });
      } else {
        await this.prisma.productVariant.updateMany({
          where,
          data: { stockAlertActive: false },
        });
      }
      return;
    }

    const users = await this.prisma.user.findMany({
      where: {
        companyId: row.sellerId,
        role: Role.SELLER,
      },
      select: { id: true },
    });

    if (users.length === 0) return;

    const saved = await this.prisma.$transaction(async (tx) => {
      const claimed =
        kind === 'product'
          ? await tx.product.updateMany({
              where,
              data: { stockAlertActive: true },
            })
          : await tx.productVariant.updateMany({
              where,
              data: { stockAlertActive: true },
            });

      if (claimed.count !== 1) return [];

      const result = [];

      for (const user of users) {
        const notification = await tx.notification.create({
          data: {
            userId: user.id,
            type: NotificationType.SYSTEM,
            title: 'Kritik stok uyarısı',
            message:
              `${row.label}: kullanılabilir stok ${available}, ` +
              `kritik eşik ${row.minStockThreshold}.`,
            link: '/seller/products',
          },
        });
        result.push(notification);
      }

      return result;
    });

    for (const notification of saved) {
      try {
        this.notifications.publishStoredNotification(notification);
      } catch (error) {
        this.logger.warn(
          `Bildirim kaydedildi fakat anlik iletim basarisiz: ${
            notification.id
          }`,
        );
      }
    }
  }
}
