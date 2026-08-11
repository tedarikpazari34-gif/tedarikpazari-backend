import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import axios from 'axios';
import { NotificationService } from '../notification/notification.service';
import { ChatGateway } from '../chat/chat.gateway';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notificationService: NotificationService,
    private readonly chatGateway: ChatGateway,
  ) {}

  private async verifyRecaptcha(token?: string) {
    const secret = process.env.RECAPTCHA_SECRET_KEY;

    if (!secret) {
      throw new BadRequestException('reCAPTCHA secret key eksik');
    }

    if (!token) {
      throw new BadRequestException('reCAPTCHA doğrulaması zorunlu');
    }

    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);

    const { data } = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      params,
    );

    if (!data?.success) {
      throw new BadRequestException('reCAPTCHA doğrulanamadı');
    }

    return true;
  }

  async signup(data: any) {
    const {
      companyName,
      email,
      password,
      role,
      recaptchaToken,
      fullName,
      phone,
      companyType,
      category,
      city,
      district,
      taxNumber,
      taxOffice,
      address,
    } = data;

    await this.verifyRecaptcha(recaptchaToken);

    if (
      !companyName?.trim() ||
      !email?.trim() ||
      !password ||
      !role ||
      !fullName?.trim() ||
      !phone?.trim()
    ) {
      throw new BadRequestException(
        'Firma adı, yetkili kişi, telefon, e-posta, şifre ve rol zorunludur',
      );
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
        email,
        phone: phone.trim(),
        city: city || null,
        taxNumber: taxNumber || null,
        taxOffice: taxOffice || null,
        address: {
          address: address || '',
          district: district || '',
          companyType: companyType || '',
          category: category || '',
          fullName: fullName.trim(),
        },
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
        role,
        companyId: company.id,
      },
      include: {
        company: true,
      },
    });

    // Bildirim hatası kullanıcı kaydını bozmasın.
    try {
      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: Role.ADMIN,
        },
        select: {
          id: true,
        },
      });

      for (const admin of adminUsers) {
        const notification = await this.notificationService.createNotification({
          userId: admin.id,
          type: NotificationType.COMPANY,
          title: 'Yeni firma başvurusu',
          message: `${company.name} adlı firma onay bekliyor.`,
          link: '/admin/companies',
        });

        this.chatGateway.emitNotificationToUser(admin.id, notification);
      }
    } catch (error) {
      console.error('Admin firma bildirimi oluşturulamadı:', error);
    }

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
