import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyStatus } from '@prisma/client';

@Injectable()
export class CompanyStatusGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user?.companyId) {
      throw new ForbiddenException('Company bilgisi bulunamadı');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: user.companyId },
      select: { status: true },
    });

    if (!company) {
      throw new ForbiddenException('Company bulunamadı');
    }

    if (company.status !== CompanyStatus.APPROVED) {
      throw new ForbiddenException('Firma henüz onaylanmamış');
    }

    return true;
  }
}