import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ChatService } from './chat.service';

describe('Chat file sender-only review status', () => {
  const findMany = jest.fn();

  const service = new ChatService(
    {
      chatMessage: { findMany },
    } as any,
    {} as any,
    {} as any,
  );

  const checkAccess = jest.spyOn(
    service as any,
    'canAccessThread',
  );

  const sender = {
    id: 'sender-1',
    role: 'BUYER',
    companyId: 'buyer-company',
  };

  beforeEach(() => {
    findMany.mockReset();
    checkAccess.mockReset();

    checkAccess.mockResolvedValue({
      id: 'thread-1',
    });

    findMany.mockResolvedValue([]);
  });

  it('kimligi olmayan kullaniciyi reddeder', async () => {
    await expect(
      service.listMyChatFileReviews(
        { role: 'BUYER' },
        'thread-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(checkAccess).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('gecersiz sohbet kimligini reddeder', async () => {
    for (const id of [
      '',
      '../secret',
      'x'.repeat(129),
      null,
    ]) {
      await expect(
        service.listMyChatFileReviews(
          sender,
          id as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(checkAccess).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('yetkisiz sohbet icin dosya sorgusu yapmaz', async () => {
    checkAccess.mockRejectedValue(
      new ForbiddenException('MOCK ACCESS DENIED'),
    );

    await expect(
      service.listMyChatFileReviews(
        sender,
        'thread-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('yalniz gondericinin dosyalarini sorgular', async () => {
    await service.listMyChatFileReviews(
      sender,
      'thread-1',
    );

    expect(checkAccess).toHaveBeenCalledWith(
      sender,
      'thread-1',
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        threadId: 'thread-1',
        senderId: 'sender-1',
        isFlagged: false,
        fileUrl: {
          startsWith: 'chat-private:',
        },
        fileReview: {
          is: {
            status: {
              in: [
                'PENDING_REVIEW',
                'APPROVED',
                'REJECTED',
              ],
            },
          },
        },
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: 50,
      select: {
        id: true,
        createdAt: true,
        fileType: true,
        fileReview: {
          select: {
            status: true,
          },
        },
      },
    });
  });

  it('uc inceleme durumunu guvenle dondurur', async () => {
    const createdAt = new Date(
      '2026-11-12T20:00:00.000Z',
    );

    findMany.mockResolvedValue([
      {
        id: 'message-1',
        createdAt,
        fileType: 'application/pdf',
        fileReview: {
          status: 'PENDING_REVIEW',
        },
      },
      {
        id: 'message-2',
        createdAt,
        fileType: 'image/png',
        fileReview: {
          status: 'APPROVED',
        },
      },
      {
        id: 'message-3',
        createdAt,
        fileType: 'image/jpeg',
        fileReview: {
          status: 'REJECTED',
        },
      },
    ]);

    const result = await service.listMyChatFileReviews(
      sender,
      'thread-1',
    );

    expect(result.items).toEqual([
      {
        id: 'message-1',
        createdAt,
        fileName: 'Belge.pdf',
        status: 'PENDING_REVIEW',
      },
      {
        id: 'message-2',
        createdAt,
        fileName: 'Gorsel.png',
        status: 'APPROVED',
      },
      {
        id: 'message-3',
        createdAt,
        fileName: 'Gorsel.jpg',
        status: 'REJECTED',
      },
    ]);
  });

  it('ozel depolama ve inceleme verilerini sizdirmaz', async () => {
    findMany.mockResolvedValue([
      {
        id: 'message-1',
        createdAt: new Date(),
        fileType: 'application/pdf',
        fileUrl:
          'chat-private:tedarik-pazari-platform/chat/private123.pdf',
        fileName: 'gizli-belge.pdf',
        reviewNote: 'Admin ic notu',
        senderId: 'sender-1',
        fileReview: {
          status: 'REJECTED',
          reviewedById: 'admin-secret',
        },
      },
    ]);

    const result = await service.listMyChatFileReviews(
      sender,
      'thread-1',
    );

    const output = JSON.stringify(result);

    for (const forbidden of [
      'chat-private:',
      'private123',
      'gizli-belge',
      'Admin ic notu',
      'admin-secret',
      'sender-1',
    ]) {
      expect(output).not.toContain(forbidden);
    }

    expect(result.items[0].fileName).toBe('Belge.pdf');
  });

  it('bilinmeyen inceleme durumunu gostermez', async () => {
    findMany.mockResolvedValue([
      {
        id: 'message-1',
        createdAt: new Date(),
        fileType: 'text/html',
        fileReview: {
          status: 'UNKNOWN',
        },
      },
      {
        id: 'message-2',
        createdAt: new Date(),
        fileType: 'application/octet-stream',
        fileReview: {
          status: 'REJECTED',
        },
      },
    ]);

    const result = await service.listMyChatFileReviews(
      sender,
      'thread-1',
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'message-2',
      fileName: 'Dosya',
      status: 'REJECTED',
    });
  });

  it('veritabani hatasini gizlemez', async () => {
    findMany.mockRejectedValue(
      new Error('MOCK DATABASE ERROR'),
    );

    await expect(
      service.listMyChatFileReviews(
        sender,
        'thread-1',
      ),
    ).rejects.toThrow('MOCK DATABASE ERROR');
  });

  it('sonuc sayisini en fazla 50 ile sinirlar', async () => {
    findMany.mockResolvedValue(
      Array.from({ length: 60 }, (_, index) => ({
        id: `message-${index}`,
        createdAt: new Date(),
        fileType: 'application/pdf',
        fileReview: {
          status: 'APPROVED',
        },
      })),
    );

    const result = await service.listMyChatFileReviews(
      sender,
      'thread-1',
    );

    expect(result.items).toHaveLength(50);
  });
});
