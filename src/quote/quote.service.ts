import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class QuoteService {
  constructor(
  private readonly prisma: PrismaService,
  private readonly notificationService: NotificationService,
  private readonly mailService: MailService,
) {}

  async create(user: any, body: CreateQuoteDto) {
    if (!user || user.role !== 'SELLER') {
      throw new ForbiddenException('Sadece SELLER teklif verebilir');
    }

    if (!body?.rfqId) {
      throw new BadRequestException('rfqId zorunlu');
    }

    const rfq = await this.prisma.rFQ.findUnique({
      where: { id: body.rfqId },
      include: {
        product: true,
        category: true,
        buyer: {
          include: {
            users: true,
          },
        },
      },
    });

    if (!rfq) {
      throw new NotFoundException('RFQ bulunamadı');
    }

    if (rfq.status !== 'OPEN') {
      throw new BadRequestException('Bu RFQ artık açık değil');
    }

    if (rfq.product) {
      if (rfq.product.sellerId !== user.companyId) {
        throw new ForbiddenException(
          'Sadece kendi ürününüze gelen RFQya teklif verebilirsiniz',
        );
      }
    } else if (rfq.categoryId) {
      const eligibleProduct = await this.prisma.product.findFirst({
        where: {
          sellerId: user.companyId,
          categoryId: rfq.categoryId,
          isActive: true,
          isApproved: true,
        },
        select: {
          id: true,
        },
      });

      if (!eligibleProduct) {
        throw new ForbiddenException(
          'Bu kategori talebine teklif verme yetkiniz yok',
        );
      }
    } else {
      throw new BadRequestException(
        'RFQ ürün veya kategori bilgisi içermiyor',
      );
    }

    const rfqLabel =
      rfq.product?.title ||
      rfq.title ||
      rfq.category?.name ||
      'Alım Talebi';

    const existingQuote = await this.prisma.quote.findFirst({
      where: {
        rfqId: body.rfqId,
        sellerId: user.companyId,
      },
    });

    if (existingQuote) {
      throw new BadRequestException('Bu RFQ için zaten teklif verdiniz');
    }

    const quote = await this.prisma.quote.create({
      data: {
        rfqId: body.rfqId,
        sellerId: user.companyId,
        unitPrice: body.unitPrice,
        deliveryDays: body.deliveryDays,
        sellerNote: body.sellerNote || null,
        status: 'SENT',
      },
      include: {
        rfq: {
          include: {
            product: true,
            buyer: true,
          },
        },
        seller: true,
      },
    });

    const buyerUser = rfq.buyer?.users?.[0];

    if (buyerUser) {
      await this.notificationService.createNotification({
        userId: buyerUser.id,
        type: 'QUOTE',
        title: 'Yeni Teklif Geldi',
        message: `${rfqLabel} için yeni teklif aldınız.`,
        link: `/buyer/rfqs/${rfq.id}`,
      });
    }
    try {
  await Promise.all(
    (rfq.buyer?.users || [])
      .filter((buyerUser) => buyerUser.email)
      .map((buyerUser) =>
        this.mailService.sendMail({
          to: buyerUser.email,
          subject: 'Tedarik Pazarı - Yeni teklif geldi',
          text: `${rfqLabel} için yeni teklif aldınız.`,
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6">
              <h2>Yeni teklif geldi</h2>
              <p><strong>${rfqLabel}</strong> için yeni teklif aldınız.</p>
              <p>Teklifi görüntülemek için Tedarik Pazarı hesabınıza giriş yapın.</p>
            </div>
          `,
        }),
      ),
  );
} catch (mailError) {
  console.error('QUOTE MAIL ERROR:', mailError);
}
    return quote;
  }

  async listMine(user: any) {
    if (!user || user.role !== 'SELLER') {
      throw new ForbiddenException('Sadece SELLER kendi tekliflerini görebilir');
    }

    return this.prisma.quote.findMany({
      where: {
        sellerId: user.companyId,
      },
      include: {
        rfq: {
          include: {
            product: true,
            buyer: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async listForBuyer(user: any) {
    if (!user || user.role !== 'BUYER') {
      throw new ForbiddenException(
        'Sadece BUYER kendisine gelen teklifleri görebilir',
      );
    }

    return this.prisma.quote.findMany({
      where: {
        rfq: {
          buyerId: user.companyId,
        },
      },
      include: {
        rfq: {
          include: {
            product: true,
          },
        },
        seller: {
          select: {
            id: true,
            name: true,
            verified: true,
            rating: true,
            reviewCount: true,
            completedDeals: true,
            responseTime: true,
            city: true,
            country: true,
            logo: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
