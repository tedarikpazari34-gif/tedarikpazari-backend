import * as crypto from 'crypto';
import { Injectable, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import axios from 'axios';
import { NotificationService } from '../notification/notification.service';
import { ChatGateway } from '../chat/chat.gateway';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notificationService: NotificationService,
    private readonly chatGateway: ChatGateway,
    private readonly mailService: MailService,
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

  async verifyEmail(token?: string) {
    if (!token) {
      throw new BadRequestException('Doğrulama tokenı eksik');
    }

    const user = await this.prisma.user.findFirst({
      where: {
        emailVerificationToken: token,
      },
    });

    if (!user) {
      throw new BadRequestException('Doğrulama bağlantısı geçersiz');
    }

    if (
      !user.emailVerificationExpiresAt ||
      user.emailVerificationExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Doğrulama bağlantısının süresi dolmuş');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
      },
    });

    return {
      message: 'E-posta adresiniz doğrulandı',
      emailVerified: true,
    };
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
      categories,
      country,
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

    const selectedCountry = country?.trim() || 'Türkiye';
    const rawPhone = String(phone).trim();
    const phoneDigits = rawPhone.replace(/\D/g, '');

    let normalizedPhone: string;

    if (selectedCountry === 'Türkiye') {
      if (!/^05\d{9}$/.test(phoneDigits) && !/^905\d{9}$/.test(phoneDigits)) {
        throw new BadRequestException(
          'Geçerli bir Türkiye telefon numarası giriniz',
        );
      }

      normalizedPhone = phoneDigits.startsWith('90')
        ? `+${phoneDigits}`
        : `+90${phoneDigits.slice(1)}`;
    } else {
      if (!rawPhone.startsWith('+') || !/^\d{7,15}$/.test(phoneDigits)) {
        throw new BadRequestException(
          'Telefon numarasını ülke koduyla birlikte giriniz (örn. +995...)',
        );
      }

      normalizedPhone = `+${phoneDigits}`;
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
        phone: normalizedPhone,
        country: selectedCountry,
        city: city || null,
        taxNumber: taxNumber || null,
        taxOffice: taxOffice || null,
        address: {
          address: address || '',
          district: district || '',
          companyType: companyType || '',
          category: category || '',
          categories: Array.isArray(categories)
            ? categories.slice(0, 3)
            : category
              ? [category]
              : [],
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

    const verificationToken = crypto.randomBytes(32).toString('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpiresAt: new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ),
      },
    });

    try {
      const verificationUrl =
        `https://tedarikpazarı.com/verify-email?token=${verificationToken}`;

      await this.mailService.sendMail({
        to: user.email,
        subject: 'Tedarik Pazarı - E-posta adresinizi doğrulayın',
        text:
          `Tedarik Pazarı hesabınızı doğrulamak için bağlantıyı açın: ${verificationUrl}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>E-posta adresinizi doğrulayın</h2>
            <p>Tedarik Pazarı hesabınızı tamamlamak için aşağıdaki bağlantıya tıklayın.</p>
            <p>
              <a href="${verificationUrl}">
                E-posta adresimi doğrula
              </a>
            </p>
            <p>Bu bağlantı 24 saat geçerlidir.</p>
            <p>Tedarik Pazarı</p>
          </div>
        `,
      });
    } catch (error) {
      console.error('E-posta doğrulama mesajı gönderilemedi:', error);
    }

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

    if (role === Role.SELLER) {
      try {
        const sellerNotification =
          await this.notificationService.createNotification({
            userId: user.id,
            type: NotificationType.COMPANY,
            title: 'Ürünlerinizi yükleyin',
            message:
              'Tedarik Pazarı’na hoş geldiniz. Alıcılara daha kolay ulaşmak için ürünlerinizi şimdi profilinize ekleyin.',
            link: '/seller/products/new',
          });

        this.chatGateway.emitNotificationToUser(
          user.id,
          sellerNotification,
        );

        await this.mailService.sendMail({
          to: user.email,
          subject: 'Tedarik Pazarı - Ürünlerinizi yükleyin',
          text:
            'Tedarik Pazarı’na hoş geldiniz. Firmanızın alıcılar tarafından daha kolay bulunabilmesi ve yeni satış fırsatlarına ulaşabilmeniz için ürünlerinizi profilinize ekleyin: https://tedarikpazarı.com/seller/products/new',
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.6">
              <h2>Tedarik Pazarı’na hoş geldiniz!</h2>
              <p>
                Firmanızın alıcılar tarafından daha kolay bulunabilmesi ve
                yeni satış fırsatlarına ulaşabilmeniz için ürünlerinizi
                profilinize ekleyin.
              </p>
              <p>
                <a href="https://tedarikpazarı.com/seller/products/new">
                  İlk ürününüzü şimdi yükleyin
                </a>
              </p>
              <p>Tedarik Pazarı</p>
            </div>
          `,
        });
      } catch (error) {
        console.error(
          'Satıcı ürün yükleme bildirimi/e-postası gönderilemedi:',
          error,
        );
      }
    }

    return {
      message: 'signup ok',
      user: {
        id: user.id,
        email: user.email,
        companyId: user.companyId,
        role: user.company.role,
        companyStatus: user.company.status,
        emailVerified: user.emailVerified,
      },
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async remindSellersWithoutProducts() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const reminderTitle = 'Ürünlerinizi eklemeyi unutmayın';

    try {
      const sellers = await this.prisma.user.findMany({
        where: {
          role: Role.SELLER,
          company: {
            createdAt: {
              lte: cutoff,
            },
            products: {
              none: {},
            },
          },
          notifications: {
            none: {
              title: reminderTitle,
            },
          },
        },
        select: {
          id: true,
          email: true,
          company: {
            select: {
              name: true,
            },
          },
        },
        take: 100,
      });

      for (const seller of sellers) {
        const notification =
          await this.notificationService.createNotification({
            userId: seller.id,
            type: NotificationType.COMPANY,
            title: reminderTitle,
            message:
              'Firmanızda henüz ürün bulunmuyor. Alıcıların sizi keşfedebilmesi için ilk ürününüzü şimdi Tedarik Pazarı’na ekleyin.',
            link: '/seller/products/new',
          });

        this.chatGateway.emitNotificationToUser(
          seller.id,
          notification,
        );

        try {
          await this.mailService.sendMail({
            to: seller.email,
            subject: 'Tedarik Pazarı - İlk ürününüzü yükleyin',
            text:
              'Tedarik Pazarı hesabınızda henüz ürün bulunmuyor. Alıcıların firmanızı ve ürünlerinizi keşfedebilmesi için ilk ürününüzü ekleyin: https://tedarikpazarı.com/seller/products/new',
            html: `
              <div style="font-family:Arial,sans-serif;line-height:1.6">
                <h2>Ürünlerinizi eklemeyi unutmayın</h2>
                <p>Merhaba ${seller.company.name},</p>
                <p>
                  Tedarik Pazarı hesabınızda henüz ürün bulunmuyor.
                  Alıcıların firmanızı ve ürünlerinizi keşfedebilmesi için
                  ilk ürününüzü ekleyebilirsiniz.
                </p>
                <p>
                  <a href="https://tedarikpazarı.com/seller/products/new">
                    İlk ürününüzü şimdi yükleyin
                  </a>
                </p>
                <p>Tedarik Pazarı</p>
              </div>
            `,
          });
        } catch (mailError) {
          console.error(
            `Satıcı ürün hatırlatma e-postası gönderilemedi (${seller.id}):`,
            mailError,
          );
        }
      }
    } catch (error) {
      console.error(
        'Ürünü olmayan satıcılar kontrol edilemedi:',
        error,
      );
    }
  }

  async resendVerificationEmail(email?: string) {
    if (!email?.trim()) {
      throw new BadRequestException('E-posta adresi zorunludur');
    }

    const normalizedEmail = email.trim();

    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    const genericResponse = {
      message:
        'Hesap mevcut ve doğrulanmamışsa doğrulama e-postası gönderildi.',
    };

    if (!user || user.emailVerified) {
      return genericResponse;
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpiresAt: new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ),
      },
    });

    const verificationUrl =
      `https://tedarikpazarı.com/verify-email?token=${verificationToken}`;

    await this.mailService.sendMail({
      to: user.email,
      subject: 'Tedarik Pazarı - E-posta adresinizi doğrulayın',
      text:
        `Tedarik Pazarı hesabınızı doğrulamak için bağlantıyı açın: ${verificationUrl}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6">
          <h2>E-posta adresinizi doğrulayın</h2>
          <p>Tedarik Pazarı hesabınızı doğrulamak için aşağıdaki bağlantıya tıklayın.</p>
          <p>
            <a href="${verificationUrl}">
              E-posta adresimi doğrula
            </a>
          </p>
          <p>Bu bağlantı 24 saat geçerlidir.</p>
        </div>
      `,
    });

    return genericResponse;
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
      emailVerified: user.emailVerified,
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
