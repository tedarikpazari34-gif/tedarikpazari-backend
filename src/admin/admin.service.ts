import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanyStatus, VerificationStatus } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async approveCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data: { status: CompanyStatus.APPROVED },
    });
  }

  async blockCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data: { status: CompanyStatus.BLOCKED },
    });
  }

  async listCompanies() {
    const companies = await this.prisma.company.findMany({
      include: {
        users: {
          where: {
            role: "ADMIN",
          },
          take: 1,
        },
        products: {
          select: {
            id: true,
            title: true,
            imageUrl: true,
            basePrice: true,
            isApproved: true,
            createdAt: true,
            images: {
              select: {
                url: true,
                isCover: true,
              },
              orderBy: {
                sortOrder: "asc",
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return companies.map((company) => {
      const productCount = company.products.length;
      const approvedProductCount = company.products.filter(
        (product) => product.isApproved
      ).length;
      const pendingProductCount = productCount - approvedProductCount;
      const lastProductAt = company.products[0]?.createdAt ?? null;

      const { products, ...companyData } = company;

      return {
        ...companyData,
        productCount,
        approvedProductCount,
        pendingProductCount,
        lastProductAt,
        products,
      };
    });
  }


  async verifyCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data: { verified: true },
    });
  }

  async unverifyCompany(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    return this.prisma.company.update({
      where: { id: companyId },
      data: { verified: false },
    });
  }

  async listVerificationRequests() {
    return this.prisma.verificationRequest.findMany({
      include: {
        company: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async approveVerificationRequest(
    requestId: string,
    adminNote?: string,
  ) {
    const request =
      await this.prisma.verificationRequest.findUnique({
        where: { id: requestId },
      });

    if (!request) {
      throw new NotFoundException(
        'Doğrulama başvurusu bulunamadı',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated =
        await tx.verificationRequest.update({
          where: { id: requestId },
          data: {
            status: VerificationStatus.APPROVED,
            adminNote: adminNote || null,
            reviewedAt: new Date(),
          },
          include: {
            company: true,
          },
        });

      await tx.company.update({
        where: { id: request.companyId },
        data: {
          verified: true,
        },
      });

      return updated;
    });
  }

  async rejectVerificationRequest(
    requestId: string,
    adminNote?: string,
  ) {
    const request =
      await this.prisma.verificationRequest.findUnique({
        where: { id: requestId },
      });

    if (!request) {
      throw new NotFoundException(
        'Doğrulama başvurusu bulunamadı',
      );
    }

    return this.prisma.verificationRequest.update({
      where: { id: requestId },
      data: {
        status: VerificationStatus.REJECTED,
        adminNote: adminNote || null,
        reviewedAt: new Date(),
      },
      include: {
        company: true,
      },
    });
  }


  async listAllProducts() {
    return this.prisma.product.findMany({
      include: {
        seller: true,
        category: true,
        images: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async deactivateProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        isActive: false,
      },
    });
  }

  async listProductReports() {
    return this.prisma.productReport.findMany({
      where: {
        status: 'OPEN',
      },
      include: {
        product: {
          include: {
            category: true,
          },
        },
        reporter: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async listPendingProducts() {
    return this.prisma.product.findMany({
      where: {
        isApproved: false,
      },
      include: {
        seller: true,
        category: true,
        images: {
          orderBy: {
            sortOrder: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async approveProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        isApproved: true,
      },
      include: {
        seller: true,
        category: true,
        images: true,
      },
    });
  }
}