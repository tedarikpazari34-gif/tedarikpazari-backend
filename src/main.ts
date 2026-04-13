import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  /**
   * GLOBAL PREFIX
   * API endpoints -> /api/*
   */
  app.setGlobalPrefix('api');

  /**
   * STATIC FILES
   * uploads klasörünü dışarı aç
   */
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads',
  });

  /**
   * CORS
   */
  app.enableCors({
    origin: true,
    credentials: true,
  });

  /**
   * GLOBAL VALIDATION
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  /**
   * SWAGGER CONFIG
   */
  const config = new DocumentBuilder()
    .setTitle('B2B Marketplace API')
    .setDescription('Production Level Escrow + RFQ + Dispute + Ledger System')
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT Authorization token',
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  /**
   * SERVER START
   */
  const port = process.env.PORT ?? 3002;

  await app.listen(port);

  console.log(`🚀 Server running on`);
  console.log(`👉 API: http://localhost:${port}/api`);
  console.log(`📘 Swagger: http://localhost:${port}/docs`);
  console.log(`🖼 Uploads: http://localhost:${port}/uploads/...`);
}

bootstrap();