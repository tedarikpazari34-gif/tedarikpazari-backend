import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  Notification,
  NotificationType,
  Prisma,
  Role,
} from '@prisma/client';
import { NotificationService } from '../notification/notification.service';

type Audience = 'ADMIN' | 'BUYER' | 'SELLER';

type NoticeContent = {
  title: string;
  message: string;
  link: string;
};

@Injectable()
export class InvoiceNotifier {
  private readonly logger = new Logger(InvoiceNotifier.name);

  constructor(
    private readonly notifications: NotificationService,
  ) {}

  // Bildirim kayıtları çağıranın veritabanı transaction'ına
  // dahildir. Transaction başarısız olursa kayıtlar da geri alınır.
  async stage(
    tx: Prisma.TransactionClient,
    audience: Audience,
    companyId: string | null,
    content: NoticeContent,
  ): Promise<Notification[]> {
    if (
      audience !== 'ADMIN' &&
      (typeof companyId !== 'string' || !companyId)
    ) {
      throw new BadRequestException('Bildirim şirketi geçersiz');
    }

    const where: Prisma.UserWhereInput =
      audience === 'ADMIN'
        ? { role: Role.ADMIN }
        : {
            role: audience === 'BUYER' ? Role.BUYER : Role.SELLER,
            companyId: companyId!,
          };

    const recipients = await tx.user.findMany({
      where,
      select: { id: true },
    });

    const staged: Notification[] = [];

    for (const recipient of recipients) {
      const notification = await tx.notification.create({
        data: {
          userId: recipient.id,
          type: NotificationType.SYSTEM,
          title: content.title,
          message: content.message,
          link: content.link,
        },
      });

      staged.push(notification);
    }

    return staged;
  }

  // Yalnız transaction başarıyla tamamlandıktan sonra çağrılır.
  // Anlık yayın hatası kayıtlı bildirimi silmez.
  publish(staged: Notification[]): void {
    for (const notification of staged) {
      try {
        this.notifications.publishStoredNotification(notification);
      } catch {
        this.logger.warn(
          'Fatura bildirimi kaydedildi fakat anlık yayın başarısız',
        );
      }
    }
  }
}
