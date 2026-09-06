import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class RfqService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly mailService: MailService,
  ) {}

  // BUYER → RFQ oluşturur
  async create(user: any, data: any) {
    if (!user || user.role !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER RFQ oluşturabilir');
    }

    const productId = data?.productId || null;
    const categoryId = data?.categoryId || null;
    const title = data?.title?.trim() || null;

    if (!productId && !categoryId) {
      throw new BadRequestException(
        'Ürün veya kategori seçilmelidir',
      );
    }

    if (!data?.quantity || Number(data.quantity) < 1) {
      throw new BadRequestException('quantity en az 1 olmalı');
    }

    let product: any = null;
    let category: any = null;

    if (productId) {
      product = await this.prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundException('Ürün bulunamadı');
      }

      if (!product.isActive || !product.isApproved) {
        throw new BadRequestException('Ürün aktif veya onaylı değil');
      }

      if (product.rfqEnabled === false) {
        throw new BadRequestException('Bu ürün için RFQ kapalı');
      }
    }

    if (categoryId) {
      category = await this.prisma.category.findUnique({
        where: { id: categoryId },
      });

      if (!category) {
        throw new NotFoundException('Kategori bulunamadı');
      }

      if (!title) {
        throw new BadRequestException(
          'Kategori bazlı talepte başlık zorunludur',
        );
      }
    }

    const rfq = await this.prisma.rFQ.create({
      data: {
        productId,
        categoryId,
        title,
        buyerId: user.companyId,
        quantity: Number(data.quantity),
        unitType: data?.unitType?.trim() || product?.unitType || null,
        deliveryCountry: data?.deliveryCountry?.trim() || null,
        deliveryCity: data?.deliveryCity?.trim() || null,
        note: data.note || null,
        status: 'OPEN',
      },
      include: {
        product: true,
        category: true,
        buyer: true,
        quotes: true,
      },
    });

    if (product) {
      const sellerUsers = await this.prisma.user.findMany({
        where: {
          companyId: product.sellerId,
          role: 'SELLER',
        },
        select: {
          id: true,
          email: true,
        },
      });

      await Promise.all(
        sellerUsers.map(async (sellerUser) => {
          await this.notificationService.createNotification({
            userId: sellerUser.id,
            type: 'RFQ',
            title: 'Yeni Alım Talebi',
            message: `${product.title} ürününüz için yeni bir alım talebi oluşturuldu.`,
            link: '/seller/rfqs',
          });

          if (sellerUser.email) {
            try {
              await this.mailService.sendMail({
                to: sellerUser.email,
                subject: 'Tedarik Pazarı - Yeni alım talebi',
                text: `${product.title} ürününüz için yeni bir alım talebi oluşturuldu. Talebi satıcı panelinizden inceleyebilir ve teklif verebilirsiniz.`,
                html: `
                  <div style="font-family:Arial,sans-serif;line-height:1.6">
                    <h2>Yeni alım talebi</h2>
                    <p><strong>${product.title}</strong> ürününüz için yeni bir alım talebi oluşturuldu.</p>
                    <p>Talebi satıcı panelinizden inceleyebilir ve uygun ise teklif verebilirsiniz.</p>
                  </div>
                `,
              });

              console.log(
                `[RFQ MATCH EMAIL] sent to=${sellerUser.email} rfq=${rfq.id}`,
              );
            } catch (err) {
              console.error(
                `[RFQ MATCH EMAIL] failed to=${sellerUser.email} rfq=${rfq.id}`,
                err,
              );
            }
          }
        }),
      );
    }

    if (category) {
      const sellerUsers = await this.prisma.user.findMany({
        where: {
          role: 'SELLER',
          company: {
            products: {
              some: {
                categoryId: category.id,
                isActive: true,
                isApproved: true,
              },
            },
          },
        },
        select: {
          id: true,
          email: true,
        },
      });

      await Promise.all(
        sellerUsers.map(async (sellerUser) => {
          await this.notificationService.createNotification({
            userId: sellerUser.id,
            type: 'RFQ',
            title: 'Yeni Kategori Talebi',
            message: `${title || category.name} için yeni bir alım talebi oluşturuldu.`,
            link: '/seller/rfqs',
          });

          if (sellerUser.email) {
            try {
              await this.mailService.sendMail({
                to: sellerUser.email,
                subject: 'Tedarik Pazarı - Yeni alım talebi',
                text: `${title || category.name} için yeni bir alım talebi oluşturuldu. Talebi satıcı panelinizden inceleyebilir ve teklif verebilirsiniz.`,
                html: `
                  <div style="font-family:Arial,sans-serif;line-height:1.6">
                    <h2>Yeni alım talebi</h2>
                    <p><strong>${title || category.name}</strong> için yeni bir alım talebi oluşturuldu.</p>
                    <p>Talebi satıcı panelinizden inceleyebilir ve uygun ise teklif verebilirsiniz.</p>
                  </div>
                `,
              });

              console.log(
                `[RFQ MATCH EMAIL] sent to=${sellerUser.email} rfq=${rfq.id}`,
              );
            } catch (err) {
              console.error(
                `[RFQ MATCH EMAIL] failed to=${sellerUser.email} rfq=${rfq.id}`,
                err,
              );
            }
          }
        }),
      );
    }

    return rfq;
  }

  async getForSellerById(user: any, id: string) {
    if (!user || user.role !== 'SELLER') {
      throw new ForbiddenException(
        'Sadece SELLER RFQ detayını görebilir',
      );
    }

    const rfq = await this.prisma.rFQ.findUnique({
      where: { id },
      include: {
        product: true,
        category: true,
        quotes: {
          include: {
            seller: true,
          },
          orderBy: {
            createdAt: 'desc',
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

    return rfq;
  }

  // BUYER → kendi RFQ'ları
  async listMine(user: any) {
    if (!user || user.role !== 'BUYER') {
      throw new ForbiddenException(
        'Sadece BUYER kendi RFQ listesini görebilir',
      );
    }

    return this.prisma.rFQ.findMany({
      where: {
        buyerId: user.companyId,
      },
      include: {
        product: true,
        quotes: {
          include: {
            seller: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // BUYER → kendi RFQ'sunu kapatır
  async close(user: any, id: string) {
    if (!user || user.role !== 'BUYER') {
      throw new ForbiddenException('Sadece BUYER RFQ kapatabilir');
    }

    const rfq = await this.prisma.rFQ.findFirst({
      where: {
        id,
        buyerId: user.companyId,
      },
      include: {
        order: true,
      },
    });

    if (!rfq) {
      throw new NotFoundException('RFQ bulunamadı');
    }

    if (rfq.status === 'CLOSED') {
      return rfq;
    }

    if (rfq.order) {
      throw new BadRequestException(
        'Siparişe dönüşmüş RFQ ayrıca kapatılamaz',
      );
    }

    return this.prisma.rFQ.update({
      where: { id },
      data: {
        status: 'CLOSED',
      },
      include: {
        product: true,
        quotes: true,
      },
    });
  }

  // PUBLIC → son açık RFQ'lar (anonim vitrin)
  async listPublicRecent() {
    return this.prisma.rFQ.findMany({
      where: {
        status: 'OPEN',
        categoryId: {
          not: null,
        },
        title: {
          not: null,
        },
      },
      select: {
        id: true,
        title: true,
        quantity: true,
        unitType: true,
        deliveryCountry: true,
        deliveryCity: true,
        note: true,
        createdAt: true,
        category: {
          select: {
            name: true,
          },
        },
        product: {
          select: {
            title: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 8,
    });
  }

  // SELLER → tüm açık RFQ'lar
  async listOpen() {
    return this.prisma.rFQ.findMany({
      where: {
        status: 'OPEN',
      },
      include: {
        product: true,
        quotes: {
          include: {
            seller: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // SELLER → kendisine gelen RFQ'lar
  async listForSeller(user: any) {
    if (!user || user.role !== 'SELLER') {
      throw new ForbiddenException(
        'Sadece SELLER gelen RFQ listesini görebilir',
      );
    }

    const sellerCategoryIds = await this.prisma.product.findMany({
      where: {
        sellerId: user.companyId,
        isActive: true,
        isApproved: true,
        categoryId: {
          not: null,
        },
      },
      select: {
        categoryId: true,
      },
      distinct: ['categoryId'],
    });

    const categoryIds = sellerCategoryIds
      .map((item) => item.categoryId)
      .filter((id): id is string => Boolean(id));

    return this.prisma.rFQ.findMany({
      where: {
        status: 'OPEN',
        OR: [
          {
            product: {
              sellerId: user.companyId,
            },
          },
          ...(categoryIds.length > 0
            ? [
                {
                  categoryId: {
                    in: categoryIds,
                  },
                },
              ]
            : []),
        ],
      },
      include: {
        product: true,
        category: true,
        quotes: {
          include: {
            seller: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}