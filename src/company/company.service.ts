import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

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

  async getPublicSellerProfile(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        products: {
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