import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async verifyCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
    });

    if (!company) {
      throw new NotFoundException('Şirket bulunamadı');
    }

    return this.prisma.company.update({
      where: { id },
      data: {
        verified: true,
        status: 'APPROVED',
      },
    });
  }

  async getMine(user: any) {
    if (!user?.companyId) {
      throw new BadRequestException('Firma bilgisi bulunamadı');
    }

    const company = await this.prisma.company.findUnique({
      where: {
        id: user.companyId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        country: true,
        description: true,
        website: true,
        logo: true,
        banner: true,
        verified: true,
        status: true,
        role: true,
        createdAt: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Şirket bulunamadı');
    }

    return company;
  }

  async updateMine(user: any, body: UpdateCompanyProfileDto) {
    if (!user?.companyId) {
      throw new BadRequestException('Firma bilgisi bulunamadı');
    }

    const company = await this.prisma.company.findUnique({
      where: {
        id: user.companyId,
      },
    });

    if (!company) {
      throw new NotFoundException('Şirket bulunamadı');
    }

    const cleanWebsite = body.website?.trim();

    if (
      cleanWebsite &&
      !/^https?:\/\/.+/i.test(cleanWebsite) &&
      !/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(cleanWebsite)
    ) {
      throw new BadRequestException('Geçerli bir web sitesi girin');
    }

    return this.prisma.company.update({
      where: {
        id: user.companyId,
      },
      data: {
        ...(body.name !== undefined
          ? { name: body.name.trim() }
          : {}),
        ...(body.description !== undefined
          ? { description: body.description.trim() || null }
          : {}),
        ...(body.phone !== undefined
          ? { phone: body.phone.trim() || null }
          : {}),
        ...(body.website !== undefined
          ? { website: cleanWebsite || null }
          : {}),
        ...(body.city !== undefined
          ? { city: body.city.trim() || null }
          : {}),
        ...(body.country !== undefined
          ? { country: body.country.trim() || null }
          : {}),
        ...(body.logo !== undefined
          ? { logo: body.logo.trim() || null }
          : {}),
        ...(body.banner !== undefined
          ? { banner: body.banner.trim() || null }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        country: true,
        description: true,
        website: true,
        logo: true,
        banner: true,
        verified: true,
        status: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async getHomepageData() {
    const [
      approvedProductCount,
      verifiedSellerCount,
      categoryCount,
      latestProducts,
      featuredSuppliers,
    ] = await this.prisma.$transaction([
      this.prisma.product.count({
        where: {
          isActive: true,
          isApproved: true,
        },
      }),

      this.prisma.company.count({
        where: {
          role: 'SELLER',
          verified: true,
          status: 'APPROVED',
        },
      }),

      this.prisma.category.count(),

      this.prisma.product.findMany({
        where: {
          isActive: true,
          isApproved: true,
        },
        select: {
          id: true,
          title: true,
          description: true,
          imageUrl: true,
          basePrice: true,
          unitType: true,
          moq: true,
          createdAt: true,
          category: {
            select: {
              id: true,
              name: true,
            },
          },
          images: {
            select: {
              id: true,
              url: true,
              isCover: true,
              sortOrder: true,
            },
            orderBy: {
              sortOrder: 'asc',
            },
          },
          seller: {
            select: {
              id: true,
              name: true,
              verified: true,
              rating: true,
              reviewCount: true,
              city: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 6,
      }),

      this.prisma.company.findMany({
        where: {
          role: 'SELLER',
          verified: true,
          status: 'APPROVED',
          products: {
            some: {
              isActive: true,
              isApproved: true,
            },
          },
        },
        select: {
          id: true,
          name: true,
          logo: true,
          banner: true,
          description: true,
          city: true,
          country: true,
          rating: true,
          reviewCount: true,
          completedDeals: true,
          _count: {
            select: {
              products: {
                where: {
                  isActive: true,
                  isApproved: true,
                },
              },
            },
          },
        },
        orderBy: [
          {
            rating: 'desc',
          },
          {
            completedDeals: 'desc',
          },
        ],
        take: 6,
      }),
    ]);

    return {
      stats: {
        approvedProducts: approvedProductCount,
        verifiedSuppliers: verifiedSellerCount,
        categories: categoryCount,
      },
      latestProducts,
      featuredSuppliers,
    };
  }

  async getPublicSellerProfile(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        products: {
          where: {
            isActive: true,
            isApproved: true,
          },
          include: {
            images: {
              orderBy: {
                sortOrder: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        sellerReviews: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Şirket bulunamadı');
    }

    return company;
  }
}