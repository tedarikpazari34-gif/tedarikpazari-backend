import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

type SellerEvent = 'CREATED' | 'STATUS_CHANGED' | 'ADMIN_EVIDENCE';

@Injectable()
export class ChargebackNotifier {
  private readonly logger = new Logger(ChargebackNotifier.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  private async deliver(
    users: Array<{ id: string }>,
    title: string,
    message: string,
    link: string,
  ) {
    const results = await Promise.allSettled(
      users.map((user) =>
        this.notifications.createNotification({
          userId: user.id,
          type: 'SYSTEM',
          title,
          message,
          link,
        }),
      ),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) {
      this.logger.warn(`${failed} chargeback bildirimi gönderilemedi`);
    }
  }

  async toSeller(caseId: string, event: SellerEvent): Promise<void> {
    try {
      const record = await this.prisma.chargebackCase.findUnique({
        where: { id: caseId },
        select: {
          orderId: true,
          order: { select: { sellerId: true } },
        },
      });

      if (!record) return;

      const users = await this.prisma.user.findMany({
        where: {
          companyId: record.order.sellerId,
          company: { role: 'SELLER' },
        },
        select: { id: true },
      });

      const explanation: Record<SellerEvent, string> = {
        CREATED: 'Yeni bir harcama itirazı takip kaydı oluşturuldu.',
        STATUS_CHANGED:
          'Harcama itirazının iç takip durumu güncellendi. ' +
          'Kesin banka sonucu için resmi iyzico bildirimi geçerlidir.',
        ADMIN_EVIDENCE:
          'Yönetici tarafından itiraz dosyasına belge eklendi.',
      };

      await this.deliver(
        users,
        'Harcama İtirazı Bildirimi',
        `Sipariş ${record.orderId}: ${explanation[event]}`,
        '/seller/chargebacks',
      );
    } catch (error) {
      this.logger.error(
        'Satıcı chargeback bildirimi başarısız',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async toAdmins(caseId: string): Promise<void> {
    try {
      const record = await this.prisma.chargebackCase.findUnique({
        where: { id: caseId },
        select: { orderId: true },
      });

      if (!record) return;

      const users = await this.prisma.user.findMany({
        where: { company: { role: 'ADMIN' } },
        select: { id: true },
      });

      await this.deliver(
        users,
        'Satıcı Harcama İtirazı Belgesi',
        `Sipariş ${record.orderId}: Satıcı yeni savunma belgesi yükledi. ` +
          'Belge henüz iyzico’ya gönderilmiş sayılmaz.',
        '/admin/chargebacks',
      );
    } catch (error) {
      this.logger.error(
        'Yönetici chargeback bildirimi başarısız',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
