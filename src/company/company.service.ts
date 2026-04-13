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
}
