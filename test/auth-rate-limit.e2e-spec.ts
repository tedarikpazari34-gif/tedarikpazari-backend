import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import request = require('supertest');

import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';

describe('Auth HTTP rate limiting', () => {
  let app: INestApplication;
  const requestPasswordReset = jest.fn().mockResolvedValue({
    message: 'İstek alındı',
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60000, limit: 10 },
        ]),
      ],
      controllers: [AuthController],
      providers: [{
        provide: AuthService,
        useValue: { requestPasswordReset },
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

  it('limits password reset requests after three attempts', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' })
      .expect(429);

    expect(requestPasswordReset).toHaveBeenCalledTimes(3);
  });
});
