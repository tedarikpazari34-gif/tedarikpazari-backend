import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ChatService } from './chat.service';

describe('Admin pending chat file reviews', () => {
  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    companyId: null,
  };

  const findMany = jest.fn();

  const service = new ChatService(
    {
      chatFileReview: { findMany },
    } as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('yalniz ADMIN erisebilir', async () => {
    for (const role of [
      Role.BUYER,
      Role.SELLER,
      Role.LOGISTICS,
    ]) {
      await expect(
        service.listPendingFileReviews({
          id: 'user-1',
          role,
          companyId: 'company-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(findMany).not.toHaveBeenCalled();
  });

  it('kimligi olmayan ADMIN erisemez', async () => {
    await expect(
      service.listPendingFileReviews({ role: Role.ADMIN }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('yalniz bekleyen ozel dosyalari sorgular', async () => {
    await service.listPendingFileReviews(admin);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING_REVIEW',
        message: {
          is: {
            isFlagged: false,
            fileUrl: { startsWith: 'chat-private:' },
          },
        },
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      take: 51,
      select: {
        id: true,
        messageId: true,
        createdAt: true,
        message: {
          select: {
            threadId: true,
            fileType: true,
          },
        },
      },
    });
  });

  it('gizli dosya bilgilerini API yanitina tasimaz', async () => {
    findMany.mockResolvedValue([
      {
        id: 'review-1',
        messageId: 'message-1',
        createdAt: new Date('2026-11-12T10:00:00Z'),
        fileUrl: 'chat-private:SECRET-STORAGE-ID',
        fileName: '05321234567.pdf',
        message: {
          threadId: 'thread-1',
          fileType: 'application/pdf',
          fileUrl: 'chat-private:SECRET-STORAGE-ID',
          fileName: '05321234567.pdf',
          content: 'PRIVATE-CONTENT',
        },
      },
    ]);

    const result = await service.listPendingFileReviews(admin);

    expect(result.items).toEqual([
      {
        id: 'review-1',
        messageId: 'message-1',
        threadId: 'thread-1',
        createdAt: new Date('2026-11-12T10:00:00Z'),
        fileType: 'application/pdf',
        status: 'PENDING_REVIEW',
      },
    ]);

    const serialized = JSON.stringify(result);

    for (const secret of [
      'SECRET-STORAGE-ID',
      '05321234567',
      'PRIVATE-CONTENT',
      'chat-private:',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('taninmayan dosya turunu gizler', async () => {
    findMany.mockResolvedValue([
      {
        id: 'review-1',
        messageId: 'message-1',
        createdAt: new Date(),
        message: {
          threadId: 'thread-1',
          fileType: 'unsafe/custom-type',
        },
      },
    ]);

    const result = await service.listPendingFileReviews(admin);

    expect(result.items[0].fileType).toBeNull();
  });

  it('50 kayit siniri ve sonraki sayfa kimligini korur', async () => {
    findMany.mockResolvedValue(
      Array.from({ length: 51 }, (_, index) => ({
        id: `review-${index}`,
        messageId: `message-${index}`,
        createdAt: new Date(),
        message: {
          threadId: `thread-${index}`,
          fileType: 'application/pdf',
        },
      })),
    );

    const result = await service.listPendingFileReviews(admin);

    expect(result.items).toHaveLength(50);
    expect(result.nextCursor).toBe('review-49');
  });

  it('cursor ile sonraki sayfayi sorgular', async () => {
    await service.listPendingFileReviews(admin, 'review-49');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 1,
        cursor: { id: 'review-49' },
        take: 51,
      }),
    );
  });

  it('gecersiz cursor degerlerini reddeder', async () => {
    for (const cursor of [
      '',
      ' ',
      'x'.repeat(129),
      123,
      null,
    ]) {
      await expect(
        service.listPendingFileReviews(admin, cursor),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(findMany).not.toHaveBeenCalled();
  });

  it('veritabani hatasini basari olarak gostermez', async () => {
    findMany.mockRejectedValue(
      new Error('MOCK DATABASE ERROR'),
    );

    await expect(
      service.listPendingFileReviews(admin),
    ).rejects.toThrow('MOCK DATABASE ERROR');
  });
});
