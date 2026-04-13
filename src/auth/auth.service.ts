import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async signup(data: any) {
    const { companyName, email, password, role } = data;

    if (!companyName || !email || !password || !role) {
      throw new BadRequestException('Eksik bilgi');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('Bu email zaten kayıtlı');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const company = await this.prisma.company.create({
      data: {
        name: companyName,
        role,
      },
    });

    await this.prisma.companyWallet.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        available: new Prisma.Decimal(0),
        locked: new Prisma.Decimal(0),
      },
      update: {},
    });

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        companyId: company.id,
      },
      include: {
        company: true,
      },
    });

    return {
      message: 'signup ok',
      user: {
        id: user.id,
        email: user.email,
        companyId: user.companyId,
        role: user.company.role,
        companyStatus: user.company.status,
      },
    };
  }

  async login(data: any) {
    const { email, password } = data;

    if (!email || !password) {
      throw new BadRequestException('Eksik bilgi');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { company: true },
    });

    if (!user) {
      throw new BadRequestException('Kullanıcı bulunamadı');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      throw new BadRequestException('Şifre hatalı');
    }

    if (!user.company) {
      throw new BadRequestException('Firma bulunamadı');
    }

    const payload = {
      sub: user.id,
      userId: user.id,
      email: user.email,
      companyId: user.companyId,
      role: user.company.role,
      companyStatus: user.company.status,
    };

    const token = await this.jwt.signAsync(payload);

    return {
      message: 'login ok',
      token,
      user: {
        id: user.id,
        email: user.email,
        companyId: user.companyId,
        role: user.company.role,
        companyStatus: user.company.status,
      },
    };
  }
}