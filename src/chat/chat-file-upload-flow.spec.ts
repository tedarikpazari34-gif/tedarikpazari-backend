import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { MailService } from '../mail/mail.service';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatFileStorageService } from './chat-file-storage.service';

describe('Private chat file upload flow', () => {
  const findThread = jest.fn();
  const createMessage = jest.fn();
  const updateThread = jest.fn();
  const findUsers = jest.fn();
  const createNotification = jest.fn();
  const upload = jest.fn();
  const remove = jest.fn();
  const emitNewMessage = jest.fn();

  const user = {
    id: 'buyer-user',
    role: Role.BUYER,
    companyId: 'buyer-company',
  };

  const thread = {
    id: 'thread-a',
    buyerId: 'buyer-company',
    sellerId: 'seller-company',
    logisticsId: 'logistics-company',
  };

  const stored = {
    publicId:
      'tedarik-pazari-platform/chat/private123.pdf',
    resourceType: 'raw' as const,
    mimeType: 'application/pdf',
    extension: 'pdf' as const,
    displayName: 'Belge.pdf',
  };

  const file = {
    originalname: 'ozel-telefon-0532.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nTEST'),
    size: 13,
  } as Express.Multer.File;

  const service = new ChatService(
    {
      chatThread: {
        findUnique: findThread,
        update: updateThread,
      },
      chatMessage: {
        create: createMessage,
      },
      user: {
        findMany: findUsers,
      },
      notification: {
        create: createNotification,
      },
    } as unknown as PrismaService,
    {
      emitNewMessage,
    } as unknown as ChatGateway,
    {} as MailService,
    undefined,
    {
      upload,
      remove,
    } as unknown as ChatFileStorageService,
  );

  beforeEach(() => {
    for (const mock of [
      findThread,
      createMessage,
      updateThread,
      findUsers,
      createNotification,
      upload,
      remove,
      emitNewMessage,
    ]) {
      mock.mockReset();
    }

    findThread.mockResolvedValue({ ...thread });
    upload.mockResolvedValue({ ...stored });
    remove.mockResolvedValue(undefined);
    updateThread.mockResolvedValue({});
    findUsers.mockResolvedValue([
      { id: 'seller-user' },
      { id: 'logistics-user' },
    ]);
    createNotification.mockResolvedValue({ id: 'notification' });

    createMessage.mockImplementation(async ({ data }) => ({
      id: 'message-a',
      ...data,
    }));
  });

  it('yetkisiz kullanici icin yukleme yapmaz', async () => {
    await expect(
      service.sendFileMessage(
        {
          id: 'stranger',
          role: Role.BUYER,
          companyId: 'other-company',
        },
        'thread-a',
        file,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(upload).not.toHaveBeenCalled();
    expect(createMessage).not.toHaveBeenCalled();
  });

  it('eksik dosyayi reddeder', async () => {
    await expect(
      service.sendFileMessage(
        user,
        'thread-a',
        undefined as unknown as Express.Multer.File,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(upload).not.toHaveBeenCalled();
  });

  it('depolama hatasinda mesaj olusturmaz', async () => {
    upload.mockRejectedValue(new Error('MOCK UPLOAD ERROR'));

    await expect(
      service.sendFileMessage(user, 'thread-a', file),
    ).rejects.toThrow('MOCK UPLOAD ERROR');

    expect(createMessage).not.toHaveBeenCalled();
  });

  it('orijinal dosya adini ve depolama kimligini gizler', async () => {
    const result = await service.sendFileMessage(
      user,
      'thread-a',
      file,
    );

    expect(createMessage).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: 'Dosya gönderildi',
        fileName: 'Belge.pdf',
        fileType: 'application/pdf',
        fileUrl:
          'chat-private:tedarik-pazari-platform/chat/private123.pdf',
      }),
    });

    expect(result.fileName).toBe('Belge.pdf');

    expect(JSON.stringify(result)).not.toContain(
      'private123',
    );

    expect(JSON.stringify(result)).not.toContain(
      '0532',
    );

    expect(JSON.stringify(emitNewMessage.mock.calls))
      .not.toContain('private123');
  });

  it('veritabani hatasinda yuklenen dosyayi siler', async () => {
    createMessage.mockRejectedValue(
      new Error('MOCK DATABASE ERROR'),
    );

    await expect(
      service.sendFileMessage(user, 'thread-a', file),
    ).rejects.toThrow('MOCK DATABASE ERROR');

    expect(remove).toHaveBeenCalledWith(stored);
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('temizleme hatasini basarili saymaz', async () => {
    createMessage.mockRejectedValue(
      new Error('MOCK DATABASE ERROR'),
    );
    remove.mockRejectedValue(
      new Error('MOCK CLEANUP ERROR'),
    );

    await expect(
      service.sendFileMessage(user, 'thread-a', file),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it.each([
    ['BUYER', user],
    ['SELLER', {
      id: 'seller-user',
      role: Role.SELLER,
      companyId: 'seller-company',
    }],
    ['LOGISTICS', {
      id: 'logistics-user',
      role: Role.LOGISTICS,
      companyId: 'logistics-company',
    }],
    ['ADMIN', {
      id: 'admin-user',
      role: Role.ADMIN,
      companyId: null,
    }],
  ])('%s dosyasi onaylanmadan yayinlanmaz',
    async (_label, actor) => {
      const result = await service.sendFileMessage(
        actor,
        'thread-a',
        file,
      );

      expect(createMessage).toHaveBeenCalledWith({
        data: expect.objectContaining({
          threadId: 'thread-a',
          senderId: actor.id,
          fileReview: {
            create: {
              status: 'PENDING_REVIEW',
            },
          },
        }),
      });

      expect(result).toMatchObject({
        id: 'message-a',
        content: 'Dosya incelemede',
        fileUrl: null,
        reviewStatus: 'PENDING_REVIEW',
      });

      expect(findUsers).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
      expect(emitNewMessage).not.toHaveBeenCalled();
      expect(updateThread).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );

  it('bildirim hatasi kaydedilen mesaji kaybettirmez', async () => {
    createNotification.mockRejectedValue(
      new Error('MOCK NOTIFICATION ERROR'),
    );

    const result = await service.sendFileMessage(
      user,
      'thread-a',
      file,
    );

    expect(result.id).toBe('message-a');
    expect(remove).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
    expect(emitNewMessage).not.toHaveBeenCalled();
  });

  it('yalniz sohbet klasorundeki dosyayi temizler', async () => {
    const deleteChatUpload = jest.fn()
      .mockResolvedValue(undefined);

    const storageService = new ChatFileStorageService(
      {
        deleteChatUpload,
      } as unknown as CloudinaryService,
    );

    await storageService.remove(stored);

    expect(deleteChatUpload).toHaveBeenCalledWith(
      stored.publicId,
      'raw',
      'authenticated',
    );

    await expect(
      storageService.remove({
        ...stored,
        publicId:
          'tedarik-pazari-platform/invoices/secret',
      }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(deleteChatUpload).toHaveBeenCalledTimes(1);
  });
});
