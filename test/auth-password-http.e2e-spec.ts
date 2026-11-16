import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { INestApplication, ExecutionContext, ValidationPipe } from '@nestjs/common';
import request = require('supertest');

import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('Password change HTTP security', () => {
  let app: INestApplication;

  const changePassword = jest.fn().mockResolvedValue({
    message: 'Şifre başarıyla değiştirildi',
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
      controllers: [AuthController],
      providers: [{
        provide: AuthService,
        useValue: { changePassword },
      }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          if (req.headers.authorization !== 'Bearer test-user') {
            return false;
          }
          req.user = { id: 'authenticated-user-1' };
          return true;
        },
      })
      .compile();

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
    changePassword.mockClear();
  });

  it('rejects requests without authentication', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .send({
        currentPassword: 'Old-Secure-Password-2026',
        newPassword: 'New-Secure-Password-2026',
      })
      .expect(403);

    expect(changePassword).not.toHaveBeenCalled();
  });

  it('uses authenticated identity and does not expose passwords', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer test-user')
      .send({
        currentPassword: 'Old-Secure-Password-2026',
        newPassword: 'New-Secure-Password-2026',
      })
      .expect(201);

    expect(changePassword).toHaveBeenCalledWith(
      'authenticated-user-1',
      'Old-Secure-Password-2026',
      'New-Secure-Password-2026',
    );
    expect(response.body).toEqual({
      message: 'Şifre başarıyla değiştirildi',
    });
  });

  it('rejects an injected userId', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer test-user')
      .send({
        userId: 'victim-user',
        currentPassword: 'Old-Secure-Password-2026',
        newPassword: 'New-Secure-Password-2026',
      })
      .expect(400);

    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects weak new passwords', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Authorization', 'Bearer test-user')
      .send({
        currentPassword: 'Old-Secure-Password-2026',
        newPassword: '123456',
      })
      .expect(400);

    expect(changePassword).not.toHaveBeenCalled();
  });
});
