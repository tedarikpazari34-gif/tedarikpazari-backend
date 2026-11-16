import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import request = require('supertest');

import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Password change real JWT HTTP security', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let sessionVersion = 0;

  const secret = 'isolated-jwt-test-secret-2026-' + 'x'.repeat(40);

  const changePassword = jest.fn().mockImplementation(async () => {
    sessionVersion += 1;
    return { message: 'Şifre başarıyla değiştirildi' };
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;

    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
        JwtModule.register({
          secret,
          signOptions: { expiresIn: '7d' },
        }),
      ],
      controllers: [AuthController],
      providers: [
        JwtStrategy,
        {
          provide: AuthService,
          useValue: { changePassword },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn().mockImplementation(async () => ({
                id: 'test-user-1',
                email: 'test@example.com',
                companyId: 'company-1',
                sessionVersion,
                company: {
                  role: 'BUYER',
                  status: 'APPROVED',
                },
              })),
            },
          },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    jwt = module.get(JwtService);
  });

  afterAll(async () => {
    if (app) await app.close();
    delete process.env.JWT_SECRET;
  });

  beforeEach(() => {
    sessionVersion = 0;
    changePassword.mockClear();
  });

  const body = {
    currentPassword: 'Old-Secure-Password-2026',
    newPassword: 'New-Secure-Password-2026',
  };

  it('rejects missing JWT', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .send(body)
      .expect(401);

    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects forged JWT', async () => {
    const forged = await new JwtService({
      secret: 'different-secret-' + 'z'.repeat(40),
    }).signAsync({
      sub: 'test-user-1',
      sessionVersion: 0,
    });

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer ' + forged)
      .send(body)
      .expect(401);

    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects expired JWT', async () => {
    const expired = await new JwtService({
      secret,
    }).signAsync({
      sub: 'test-user-1',
      sessionVersion: 0,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer ' + expired)
      .send(body)
      .expect(401);

    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects old JWT after password change', async () => {
    const token = await jwt.signAsync({
      sub: 'test-user-1',
      sessionVersion: 0,
    });

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer ' + token)
      .send(body)
      .expect(201);

    expect(changePassword).toHaveBeenCalledTimes(1);

    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer ' + token)
      .send(body)
      .expect(401);

    expect(changePassword).toHaveBeenCalledTimes(1);
  });
});
