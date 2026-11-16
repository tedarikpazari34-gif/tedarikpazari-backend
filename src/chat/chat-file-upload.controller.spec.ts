import {
  ExecutionContext,
  INestApplication,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatFileAccessService } from './chat-file-access.service';
import { ChatFileUploadEnabledGuard } from './chat-file-upload-enabled.guard';
import { ChatFileContentReviewGuard } from './chat-file-content-review.guard';
import { CHAT_FILE_MAX_BYTES } from './chat-file-policy';

describe('Chat private upload HTTP security', () => {
  let app: INestApplication;

  const previousFlag =
    process.env.CHAT_FILE_UPLOADS_ENABLED;

  const sendFileMessage = jest.fn();

  const user = {
    id: 'buyer-user',
    companyId: 'buyer-company',
    role: 'BUYER',
  };

  const pdf = Buffer.from('%PDF-1.7\nTEST FILE');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: { sendFileMessage },
        },
        {
          provide: ChatFileAccessService,
          useValue: { getDownload: jest.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req =
            context.switchToHttp().getRequest();

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
      // Yalnızca HTTP sözleşme testlerinde moderasyon
      // kilidi taklit edilerek başarılı yükleme akışı sınanır.
      .overrideGuard(ChatFileContentReviewGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();

    if (previousFlag === undefined) {
      delete process.env.CHAT_FILE_UPLOADS_ENABLED;
    } else {
      process.env.CHAT_FILE_UPLOADS_ENABLED =
        previousFlag;
    }
  });

  beforeEach(() => {
    process.env.CHAT_FILE_UPLOADS_ENABLED = 'true';

    sendFileMessage.mockReset();
    sendFileMessage.mockResolvedValue({
      id: 'message-a',
      threadId: 'thread-a',
      content: 'Dosya gönderildi',
      fileName: 'Belge.pdf',
      fileType: 'application/pdf',
      fileUrl:
        '/api/chat/threads/thread-a/files/message-a',
    });
  });

  it('POST endpoint JWT ve ozellik kilidi ile korunur', () => {
    const handler =
      ChatController.prototype.uploadChatFile;

    expect(
      Reflect.getMetadata(METHOD_METADATA, handler),
    ).toBe(RequestMethod.POST);

    expect(
      Reflect.getMetadata(PATH_METADATA, handler),
    ).toBe('threads/:threadId/upload');

    const guards =
      Reflect.getMetadata(GUARDS_METADATA, handler);

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(ChatFileUploadEnabledGuard);
    expect(guards).toContain(ChatFileContentReviewGuard);

    expect(
      Reflect.getMetadata(INTERCEPTORS_METADATA, handler),
    ).toHaveLength(1);
  });

  it('kimliksiz yukleme istegini reddeder', async () => {
    await request(app.getHttpServer())
      .post('/api/chat/threads/thread-a/upload')
      .attach('file', pdf, 'secret.pdf')
      .expect(401);

    expect(sendFileMessage).not.toHaveBeenCalled();
  });

  it('ozellik kapaliyken HTTP 503 dondurur', async () => {
    delete process.env.CHAT_FILE_UPLOADS_ENABLED;

    await request(app.getHttpServer())
      .post('/api/chat/threads/thread-a/upload')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .attach('file', pdf, 'secret.pdf')
      .expect(503);

    expect(sendFileMessage).not.toHaveBeenCalled();
  });

  it('yetkili dosyayi sohbet servisine iletir', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat/threads/thread-a/upload')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .attach('file', pdf, {
        filename: 'ozel-telefon.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(sendFileMessage).toHaveBeenCalledTimes(1);

    const args = sendFileMessage.mock.calls[0];

    expect(args[0]).toEqual(user);
    expect(args[1]).toBe('thread-a');
    expect(args[2].buffer.equals(pdf)).toBe(true);
    expect(args[2].size).toBe(pdf.length);
    expect(args[2].mimetype).toBe('application/pdf');

    expect(response.body.fileName).toBe('Belge.pdf');

    expect(JSON.stringify(response.body))
      .not.toContain('ozel-telefon');
  });

  it('dosyasiz istegi reddeder', async () => {
    await request(app.getHttpServer())
      .post('/api/chat/threads/thread-a/upload')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .field('description', 'empty')
      .expect(400);

    expect(sendFileMessage).not.toHaveBeenCalled();
  });

  it('10 MB sinirini asan dosyayi reddeder', async () => {
    const tooLarge = Buffer.alloc(
      CHAT_FILE_MAX_BYTES + 1,
      65,
    );

    await request(app.getHttpServer())
      .post('/api/chat/threads/thread-a/upload')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .attach('file', tooLarge, {
        filename: 'large.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);

    expect(sendFileMessage).not.toHaveBeenCalled();
  });

  it('yanlis multipart alanini reddeder', async () => {
    await request(app.getHttpServer())
      .post('/api/chat/threads/thread-a/upload')
      .set('Authorization', 'Bearer LOCAL_MOCK_TOKEN')
      .attach('wrongField', pdf, 'test.pdf')
      .expect(400);

    expect(sendFileMessage).not.toHaveBeenCalled();
  });

  it('ozellik kilidi yalniz true degerini kabul eder', () => {
    const guard = new ChatFileUploadEnabledGuard();

    for (const value of ['false', '1', 'TRUE', 'yes']) {
      process.env.CHAT_FILE_UPLOADS_ENABLED = value;

      expect(() => guard.canActivate()).toThrow();
    }

    process.env.CHAT_FILE_UPLOADS_ENABLED = 'true';

    expect(guard.canActivate()).toBe(true);
  });
});
