import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';

describe('Password reset HTTP security', () => {
  let app: INestApplication;
  const requestPasswordReset = jest.fn().mockResolvedValue({
    message: 'E-posta adresi kayıtlıysa şifre sıfırlama bağlantısı gönderilecektir',
  });
  const resetPassword = jest.fn().mockResolvedValue({
    message: 'Şifreniz başarıyla sıfırlandı',
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [AuthController],
      providers: [{
        provide: AuthService,
        useValue: { requestPasswordReset, resetPassword },
      }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts a valid reset request without exposing account existence', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'owner@example.com' })
      .expect(201);

    expect(requestPasswordReset).toHaveBeenCalledWith('owner@example.com');
    expect(response.body).not.toHaveProperty('token');
    expect(JSON.stringify(response.body)).not.toContain('owner@example.com');
  });

  it('rejects invalid email input', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'invalid', userId: 'victim' })
      .expect(400);

    expect(requestPasswordReset).not.toHaveBeenCalled();
  });

  it('rejects malformed reset tokens', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: 'invalid', newPassword: 'Secure-Password-2026' })
      .expect(400);

    expect(resetPassword).not.toHaveBeenCalled();
  });

  it('accepts valid reset input without exposing credentials', async () => {
    const token = 'a'.repeat(64);
    const response = await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'Secure-Password-2026' })
      .expect(201);

    expect(resetPassword).toHaveBeenCalledWith(token, 'Secure-Password-2026');
    expect(response.body).toEqual({ message: 'Şifreniz başarıyla sıfırlandı' });
  });

  it('rejects weak passwords and extra fields', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: 'a'.repeat(64), newPassword: '123456' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({
        token: 'a'.repeat(64),
        newPassword: 'Secure-Password-2026',
        userId: 'victim',
      })
      .expect(400);

    expect(resetPassword).not.toHaveBeenCalled();
  });
});
