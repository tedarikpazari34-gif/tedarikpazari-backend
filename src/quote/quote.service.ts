import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuoteDto } from './dto/create-quote.dto';

@Injectable()
export class QuoteService {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    });

    if (!rfq) {
      throw new NotFoundException('RFQ bulunamadı');
    }

    if (rfq.status !== 'OPEN') {
      throw new BadRequestException('Bu RFQ artık açık değil');
    }

    if (!rfq.product) {
      throw new BadRequestException('RFQ ürünü bulunamadı');
    }

    if (rfq.product.sellerId !== user.companyId) {
      throw new ForbiddenException('Sadece kendi ürününüze gelen RFQya teklif verebilirsiniz');
    }

    const existingQuote = await this.prisma.quote.findFirst({
      where: {
        rfqId: body.rfqId,
        sellerId: user.companyId,
      },
    });

    if (existingQuote) {
      throw new BadRequestException('Bu RFQ için zaten teklif verdiniz');
    }

    return this.prisma.quote.create({
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
      throw new ForbiddenException('Sadece BUYER kendisine gelen teklifleri görebilir');
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
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
