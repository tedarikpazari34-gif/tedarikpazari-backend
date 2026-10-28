import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

export type ReminderStage = '72H' | '24H' | 'OVERDUE';

export function deadlineStage(
  due: Date,
  now: Date,
): ReminderStage | null {
  const hours = (due.getTime() - now.getTime()) / 3600000;

  if (!Number.isFinite(hours)) return null;
  if (hours <= 0) return 'OVERDUE';
  if (hours <= 24) return '24H';
  if (hours <= 72) return '72H';

  return null;
}

@Injectable()
export class ChargebackDeadlineService implements OnApplicationBootstrap {
  private readonly logger =
    new Logger(ChargebackDeadlineService.name);

  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    // Sunucu acilisini bekletmeden gecikmis kontrolleri baslat.
    void this.catchUpAfterStartup().catch((error) => {
      this.logger.error(
        'Harcama itirazi acilis kontrolu beklenmedik hata',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private async catchUpAfterStartup(): Promise<void> {
    try {
      await this.runReminders();
    } catch (error) {
      this.logger.error(
        'Acilista son tarih hatirlatmalari basarisiz',
        error instanceof Error ? error.stack : String(error),
      );
    }

    try {
      await this.runMissingDeadlineReminders();
    } catch (error) {
      this.logger.error(
        'Acilista bilinmeyen son tarih kontrolu basarisiz',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }



  @Cron(CronExpression.EVERY_HOUR)
  async runReminders(now: Date = new Date()) {
    if (this.running) return;
    this.running = true;

    try {
      await this.processReminders(now);
    } finally {
      this.running = false;
    }
  }


  private missingDeadlineRunning = false;

  @Cron(CronExpression.EVERY_HOUR)
  async runMissingDeadlineReminders() {
    if (this.missingDeadlineRunning) return;

    this.missingDeadlineRunning = true;

    try {
      await this.processMissingDeadlines();
    } finally {
      this.missingDeadlineRunning = false;
    }
  }

  private async processMissingDeadlines() {
    let cursor: string | null = null;
    let admins: Array<{ id: string }> | null = null;

    while (true) {
      const cases = await this.prisma.chargebackCase.findMany({
        where: {
          status: {
            in: ['OPEN', 'EVIDENCE_PREPARING'],
          },
          responseDueAt: null,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: {
          id: true,
          orderId: true,
        },
        orderBy: { id: 'asc' },
        take: 200,
      });

      if (cases.length === 0) break;

      if (admins === null) {
        admins = await this.prisma.user.findMany({
          where: {
            company: { role: 'ADMIN' },
          },
          select: { id: true },
        });
      }

      for (const record of cases) {
        for (const admin of admins) {
          const key = [
            'CHARGEBACK_MISSING_DEADLINE',
            record.id,
            admin.id,
          ].join(':');

          const title =
            'Harcama itirazı: son tarih bilinmiyor';

          const message =
            '[' + key + '] Sipariş ' + record.orderId +
            '. Savunma son tarihi bilinmiyor. ' +
            'İyzico Merchant Panel üzerinden resmî ' +
            'son tarihi ve saatini acilen doğrulayın.';

          try {
            const created = await this.prisma.$transaction(
              async (tx) => {
                const current = await tx.$queryRaw<
                  Array<{
                    id: string;
                    status: string;
                    responseDueAt: Date | null;
                  }>
                >`
                  SELECT "id", "status", "responseDueAt"
                  FROM "ChargebackCase"
                  WHERE "id" = ${record.id}
                  FOR UPDATE
                `;

                const live = current[0];

                if (
                  !live ||
                  !['OPEN', 'EVIDENCE_PREPARING'].includes(
                    live.status,
                  ) ||
                  live.responseDueAt !== null
                ) {
                  return null;
                }

                const existing =
                  await tx.notification.findFirst({
                    where: {
                      userId: admin.id,
                      type: 'SYSTEM',
                      message,
                    },
                    select: { id: true },
                  });

                if (existing) return null;

                return tx.notification.create({
                  data: {
                    userId: admin.id,
                    type: 'SYSTEM',
                    title,
                    message,
                    link: '/admin/chargebacks',
                  },
                });
              },
            );

            if (created) {
              this.notifications.publishStoredNotification(
                created,
              );
            }
          } catch (error) {
            this.logger.error(
              'Bilinmeyen son tarih bildirimi basarisiz: ' +
                record.id,
              error instanceof Error
                ? error.stack
                : String(error),
            );
          }
        }
      }

      if (cases.length < 200) break;

      cursor = cases[cases.length - 1].id;
    }
  }

  private async processReminders(now: Date) {
    const until = new Date(now.getTime() + 72 * 3600000);

    let cursor: { id: string; due: Date } | null = null;

    while (true) {
      const cases = await this.prisma.chargebackCase.findMany({
        where: {
          status: {
            in: ['OPEN', 'EVIDENCE_PREPARING'],
          },
          responseDueAt: {
            not: null,
            lte: until,
          },
          ...(cursor
            ? {
                OR: [
                  { responseDueAt: { gt: cursor.due } },
                  {
                    responseDueAt: cursor.due,
                    id: { gt: cursor.id },
                  },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          orderId: true,
          responseDueAt: true,
          order: {
            select: { sellerId: true },
          },
        },
        orderBy: [
          { responseDueAt: 'asc' },
          { id: 'asc' },
        ],
        take: 200,
      });

      for (const record of cases) {
        if (!record.responseDueAt) continue;

        const stage = deadlineStage(record.responseDueAt, now);
        if (!stage) continue;

        const recipients = await this.prisma.user.findMany({
          where: {
            OR: [
              {
                companyId: record.order.sellerId,
                company: { role: 'SELLER' },
              },
              {
                company: { role: 'ADMIN' },
              },
            ],
          },
          select: {
            id: true,
            company: {
              select: { role: true },
            },
          },
        });

        for (const user of recipients) {
          const key = [
            'CHARGEBACK_DEADLINE',
            record.id,
            record.responseDueAt.toISOString(),
            stage,
            user.id,
          ].join(':');

          const title =
            stage === 'OVERDUE'
              ? 'Harcama itirazı süresi doldu'
              : `Harcama itirazı: ${stage} uyarısı`;

          const message =
            `[${key}] Sipariş ${record.orderId}. ` +
            'Belge teslim son tarihi: ' +
            record.responseDueAt.toISOString() +
            '. İyzico panelindeki resmi süreyi kontrol edin.';

          const link =
            user.company.role === 'ADMIN'
              ? '/admin/chargebacks'
              : '/seller/chargebacks';

          try {
            const created = await this.prisma.$transaction(
              async (tx) => {
                const current = await tx.$queryRaw<
                  Array<{
                    id: string;
                    status: string;
                    responseDueAt: Date | null;
                  }>
                >`
                  SELECT "id", "status", "responseDueAt"
                  FROM "ChargebackCase"
                  WHERE "id" = ${record.id}
                  FOR UPDATE
                `;

                const live = current[0];

                if (
                  !live ||
                  !['OPEN', 'EVIDENCE_PREPARING'].includes(
                    live.status,
                  ) ||
                  !live.responseDueAt ||
                  live.responseDueAt.getTime() !==
                    record.responseDueAt!.getTime()
                ) {
                  return null;
                }

                const locked = await tx.$queryRaw<
                  Array<{ locked: boolean }>
                >`
                  SELECT pg_try_advisory_xact_lock(
                    hashtext(${key})::bigint
                  ) AS locked
                `;

                if (!locked[0]?.locked) return null;

                const existing =
                  await tx.notification.findFirst({
                    where: {
                      userId: user.id,
                      type: 'SYSTEM',
                      message,
                    },
                    select: { id: true },
                  });

                if (existing) return null;

                return tx.notification.create({
                  data: {
                    userId: user.id,
                    type: 'SYSTEM',
                    title,
                    message,
                    link,
                  },
                });
              },
            );

            if (created) {
              // Veritabani islemi tamamlandiktan sonra yayinla.
              // Kalici uygulama ici kayit push'tan bagimsizdir.
              this.notifications.publishStoredNotification(
                created,
              );
            }
          } catch (error) {
            this.logger.error(
              `Chargeback hatirlatmasi basarisiz: ${record.id}`,
              error instanceof Error
                ? error.stack
                : String(error),
            );
          }
        }
      }

      if (cases.length < 200) break;

      const last = cases[cases.length - 1];

      if (!last.responseDueAt) break;

      cursor = {
        id: last.id,
        due: last.responseDueAt,
      };
    }
  }
}
