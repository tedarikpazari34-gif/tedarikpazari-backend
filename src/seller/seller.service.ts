import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class SellerService {
  constructor(private prisma: PrismaService) {}

  async getSeller(id: string) {
    return this.prisma.company.findUnique({
      where: { id },
      include: {
        products: true,
      },
    });
  }
}
