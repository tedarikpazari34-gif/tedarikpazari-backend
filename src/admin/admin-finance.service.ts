import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AdminFinanceService {
  constructor(private prisma: PrismaService) {}

  // ADMIN: ledger list
  async listLedger(user: any, take = 50) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN');
    }

    return this.prisma.ledgerEntry.findMany({
      take,
      orderBy: { createdAt: 'desc' },
      include: { order: true },
    });
  }


}