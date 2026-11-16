import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  NotFoundException,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatFileAccessService } from './chat-file-access.service';

describe('Chat file download HTTP security', () => {
  let app: INestApplication;

  const getDownload = jest.fn();

  const user = {
    id: 'test-buyer-user',
    companyId: 'test-buyer-company',
    role: 'BUYER',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: {},
        },
        {
          provide: ChatFileAccessService,
          useValue: { getDownload },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest();

          if (
            req.headers.authorization !==
            'Bearer LOCAL_MOCK_TOKEN'
          ) {
            throw new UnauthorizedException();
          }

          req.user = user;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    getDownload.mockReset();
    getDownload.mockResolvedValue({
      url: 'https://example.invalid/signed-test-file',
      expiresAt: '2026-11-12T22:00:00.000Z',
      fileName: 'Belge.pdf',
    });
  });

  it('GET endpoint JWT guard ile korunur', () => {
    const handler =
      ChatController.prototype.downloadChatFile;

    expect(
      Reflect.getMetadata(METHOD_METADATA, handler),
    ).toBe(RequestMethod.GET);

    expect(
      Reflect.getMetadata(PATH_METADATA, handler),
    ).toBe('threads/:threadId/files/:messageId');

    expect(
      Reflect.getMetadata(GUARDS_METADATA, handler),
    ).toContain(JwtAuthGuard);
  });

  it('kimliksiz istegi reddeder', async () => {
    await request(app.getHttpServer())
      .get('/api/chat/threads/thread-a/files/message-a')
      .expect(401);

    expect(getDownload).not.toHaveBeenCalled();
  });

  it('yetkili istegi dosya erisim servisine yonlendirir', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/chat/threads/thread-a/files/message-a')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .expect(200);

    expect(getDownload).toHaveBeenCalledWith(
      user,
      'thread-a',
      'message-a',
    );

    expect(response.body.fileName).toBe('Belge.pdf');
    expect(response.body.url).toBe(
      'https://example.invalid/signed-test-file',
    );
  });

  it('sohbet erisim reddini HTTP 403 olarak dondurur', async () => {
    getDownload.mockRejectedValue(
      new ForbiddenException('Erisim yasak'),
    );

    await request(app.getHttpServer())
      .get('/api/chat/threads/thread-a/files/message-a')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .expect(403);
  });

  it('baska sohbet dosyasini HTTP 404 olarak reddeder', async () => {
    getDownload.mockRejectedValue(
      new NotFoundException('Dosya bulunamadi'),
    );

    await request(app.getHttpServer())
      .get('/api/chat/threads/thread-a/files/message-b')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .expect(404);
  });

  it('hatalı dosya referansini aciklamaz', async () => {
    getDownload.mockRejectedValue(
      new NotFoundException('Dosya bulunamadi'),
    );

    const response = await request(app.getHttpServer())
      .get('/api/chat/threads/thread-a/files/secret-id')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .expect(404);

    expect(JSON.stringify(response.body)).not.toContain(
      'cloudinary.com',
    );
  });
});
