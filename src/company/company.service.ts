import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { UpdateCompanyProfileDto } from './dto/update-company-profile.dto';
import { SensitiveDataService } from '../common/security/sensitive-data.service';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sensitiveData: SensitiveDataService,
  ) {}

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
          taxNumber: true,
          paymentIdentityNumber: true,
          iyzicoSubMerchantKey: true,
          taxOffice: true,
          address: true,
        verified: true,
        status: true,
        role: true,
        createdAt: true,
      },
    });

    if (!company) {
      throw new NotFoundException('Şirket bulunamadı');
    }

    const {
      paymentIdentityNumber,
      iyzicoSubMerchantKey,
      ...safeCompany
    } = company;

    return {
      ...safeCompany,
      hasPaymentIdentityNumber: Boolean(paymentIdentityNumber),
      iyzicoOnboardingCompleted: Boolean(iyzicoSubMerchantKey),
    };
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

    const currentAddress =
      company.address &&
      typeof company.address === 'object' &&
      !Array.isArray(company.address)
        ? (company.address as Record<string, any>)
        : {};

    const submittedCategories =
      body.categories !== undefined
        ? body.categories
            .map((item) => String(item).trim())
            .filter(Boolean)
        : undefined;

    if (submittedCategories && submittedCategories.length > 3) {
      throw new BadRequestException('En fazla 3 kategori seçebilirsiniz');
    }

    const selectedCategories =
      submittedCategories !== undefined
        ? submittedCategories
        : Array.isArray(currentAddress.categories)
          ? currentAddress.categories
          : [];

    const nextAddress = {
      ...currentAddress,
      ...(body.address !== undefined
        ? { address: body.address.trim() }
        : {}),
      ...(body.district !== undefined
        ? { district: body.district.trim() }
        : {}),
      ...(body.postalCode !== undefined
        ? { postalCode: body.postalCode.trim() }
        : {}),
      ...(body.companyType !== undefined
        ? { companyType: body.companyType.trim() }
        : {}),
      ...(body.fullName !== undefined
        ? { fullName: body.fullName.trim() }
        : {}),
      ...(body.categories !== undefined
        ? {
            category: selectedCategories[0] || '',
            categories: selectedCategories,
          }
        : {}),
    };

    const selectedCountry =
      body.country !== undefined
        ? body.country.trim()
        : company.country || 'Türkiye';

    const selectedCompanyType =
      body.companyType !== undefined
        ? body.companyType.trim()
        : String(currentAddress.companyType || '').trim();

    const selectedTaxNumber =
      body.taxNumber !== undefined
        ? body.taxNumber.trim()
        : company.taxNumber || '';

    const selectedIdentityNumber =
      body.paymentIdentityNumber !== undefined
        ? body.paymentIdentityNumber.trim()
        : this.sensitiveData.decrypt(company.paymentIdentityNumber) || '';

    const countryChanged =
      body.country !== undefined &&
      body.country.trim() !== (company.country || '').trim();

    const legalFieldsTouched =
      body.companyType !== undefined ||
      body.taxNumber !== undefined ||
      body.paymentIdentityNumber !== undefined ||
      body.taxOffice !== undefined ||
      body.district !== undefined ||
      body.address !== undefined ||
      body.categories !== undefined ||
      countryChanged;

    if (legalFieldsTouched) {
      if (selectedCountry === 'Türkiye') {
        if (selectedCompanyType === 'Şahıs') {
          if (!/^\d{11}$/.test(selectedIdentityNumber)) {
            throw new BadRequestException(
              'Şahıs şirketi için 11 haneli T.C. kimlik numarası zorunludur',
            );
          }
        } else if (['Limited', 'Anonim'].includes(selectedCompanyType)) {
          if (!/^\d{10}$/.test(selectedTaxNumber)) {
            throw new BadRequestException(
              'Limited ve Anonim şirketler için 10 haneli vergi kimlik numarası zorunludur',
            );
          }
        } else {
          throw new BadRequestException('Geçerli bir şirket türü seçiniz');
        }
      } else if (!selectedTaxNumber) {
        throw new BadRequestException(
          'Yabancı şirketler için vergi/şirket kayıt numarası zorunludur',
        );
      }
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
        ...(body.taxOffice !== undefined
          ? { taxOffice: body.taxOffice.trim() || null }
          : {}),
        ...(body.address !== undefined ||
        body.district !== undefined ||
        body.postalCode !== undefined ||
        body.companyType !== undefined ||
        body.fullName !== undefined ||
        body.categories !== undefined
          ? { address: nextAddress }
          : {}),
        ...(body.taxNumber !== undefined ||
        body.paymentIdentityNumber !== undefined ||
        body.companyType !== undefined ||
        body.country !== undefined
          ? selectedCountry === 'Türkiye' && selectedCompanyType === 'Şahıs'
            ? {
                taxNumber: null,
                paymentIdentityNumber:
                  this.sensitiveData.encrypt(selectedIdentityNumber),
              }
            : {
                taxNumber: selectedTaxNumber || null,
                paymentIdentityNumber:
                  body.paymentIdentityNumber !== undefined
                    ? this.sensitiveData.encrypt(selectedIdentityNumber)
                    : company.paymentIdentityNumber,
              }
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
          taxNumber: true,
          taxOffice: true,
          address: true,
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
      select: {
        id: true,
        name: true,
        verified: true,
        status: true,
        logo: true,
        banner: true,
        description: true,
        city: true,
        country: true,
        responseTime: true,
        completedDeals: true,
        rating: true,
        reviewCount: true,
        createdAt: true,

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

    const profileCompletion =
      [
        company.logo,
        company.banner,
        company.description,
        company.products.length > 0,
        company.verified,
      ].filter(Boolean).length * 20;

    return {
      ...company,
      stats: {
        productCount: company.products.length,
        completedDeals: company.completedDeals ?? 0,
        rating: company.rating ?? 0,
        reviewCount: company.reviewCount ?? 0,
        memberSince: company.createdAt,
        responseTime: company.responseTime || null,
        profileCompletion,
      },
    };
  }
}
