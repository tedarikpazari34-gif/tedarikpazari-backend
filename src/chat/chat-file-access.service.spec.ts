import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ChatService } from './chat.service';
import { ChatFileAccessService } from './chat-file-access.service';

describe('Chat file membership and download security', () => {
  const findUnique = jest.fn();
  const assertThreadAccess = jest.fn();
  const createChatDownloadUrl = jest.fn();

  const service = new ChatFileAccessService(
    {
      chatMessage: { findUnique },
    } as unknown as PrismaService,
    {
      assertThreadAccess,
    } as unknown as ChatService,
    {
      createChatDownloadUrl,
    } as unknown as CloudinaryService,
  );

  const user = {
    id: 'buyer-user',
    companyId: 'buyer-company',
    role: 'BUYER',
  };

  const validMessage = {
    threadId: 'thread-a',
    isFlagged: false,
    fileUrl:
      'chat-private:tedarik-pazari-platform/chat/private123.pdf',
    fileType: 'application/pdf',
    fileReview: { status: 'APPROVED' },
  };

  beforeEach(() => {
    findUnique.mockReset();
    assertThreadAccess.mockReset();
    createChatDownloadUrl.mockReset();

    assertThreadAccess.mockResolvedValue(undefined);
    findUnique.mockResolvedValue({ ...validMessage });
    createChatDownloadUrl.mockReturnValue({
      url: 'https://res.cloudinary.com/mock/signed',
      expiresAt: '2026-11-12T19:00:00.000Z',
    });
  });

  it('yetkili kullaniciya sureli PDF baglantisi verir', async () => {
    const result = await service.getDownload(
      user,
      'thread-a',
      'message-a',
    );

    expect(assertThreadAccess).toHaveBeenCalledWith(
      user,
      'thread-a',
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'message-a' },
      select: {
        threadId: true,
        fileUrl: true,
        fileType: true,
        isFlagged: true,
        fileReview: { select: { status: true } },
      },
    });

    expect(createChatDownloadUrl).toHaveBeenCalledWith(
      'tedarik-pazari-platform/chat/private123.pdf',
      'raw',
      'pdf',
    );

    expect(result.fileName).toBe('Belge.pdf');
    expect(JSON.stringify(result)).not.toContain(
      'private123',
    );
  });

  it('yetkili gorsel icin dogru kaynak turunu kullanir', async () => {
    findUnique.mockResolvedValue({
      ...validMessage,
      fileUrl:
        'chat-private:tedarik-pazari-platform/chat/image123',
      fileType: 'image/png',
    });

    const result = await service.getDownload(
      user,
      'thread-a',
      'image-message',
    );

    expect(createChatDownloadUrl).toHaveBeenCalledWith(
      'tedarik-pazari-platform/chat/image123',
      'image',
      'png',
    );

    expect(result.fileName).toBe('Gorsel.png');
  });

  it('yetkisiz kullanicida dosya sorgusu bile yapmaz', async () => {
    assertThreadAccess.mockRejectedValue(
      new ForbiddenException('Erisim yasak'),
    );

    await expect(
      service.getDownload(user, 'thread-a', 'message-a'),
    ).rejects.toThrow(ForbiddenException);

    expect(findUnique).not.toHaveBeenCalled();
    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  it('baska sohbete ait mesaji reddeder', async () => {
    findUnique.mockResolvedValue({
      ...validMessage,
      threadId: 'thread-b',
    });

    await expect(
      service.getDownload(user, 'thread-a', 'message-a'),
    ).rejects.toThrow(NotFoundException);

    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  it('engellenmis mesaji reddeder', async () => {
    findUnique.mockResolvedValue({
      ...validMessage,
      isFlagged: true,
    });

    await expect(
      service.getDownload(user, 'thread-a', 'message-a'),
    ).rejects.toThrow(NotFoundException);

    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  it('eski herkese acik dosya yolunu reddeder', async () => {
    findUnique.mockResolvedValue({
      ...validMessage,
      fileUrl: '/uploads/chat/old-secret.pdf',
    });

    await expect(
      service.getDownload(user, 'thread-a', 'message-a'),
    ).rejects.toThrow(NotFoundException);

    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  it('sahte depolama referansini reddeder', async () => {
    findUnique.mockResolvedValue({
      ...validMessage,
      fileUrl:
        'chat-private:tedarik-pazari-platform/chat/../secret',
    });

    await expect(
      service.getDownload(user, 'thread-a', 'message-a'),
    ).rejects.toThrow(NotFoundException);

    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  it('desteklenmeyen dosya turunu reddeder', async () => {
    findUnique.mockResolvedValue({
      ...validMessage,
      fileType: 'application/javascript',
    });

    await expect(
      service.getDownload(user, 'thread-a', 'message-a'),
    ).rejects.toThrow(NotFoundException);

    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  it('bulunamayan mesaji reddeder', async () => {
    findUnique.mockResolvedValue(null);

    await expect(
      service.getDownload(user, 'thread-a', 'missing'),
    ).rejects.toThrow(NotFoundException);

    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  it('PDF kimligini gorsel turunde acmaz', async () => {
    findUnique.mockResolvedValue({
      ...validMessage,
      fileType: 'image/jpeg',
    });

    await expect(
      service.getDownload(user, 'thread-a', 'message-a'),
    ).rejects.toThrow(NotFoundException);

    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  const blockedReviewCases: Array<
    [string, { status?: string } | null]
  > = [
    ['inceleme bekleyen', { status: 'PENDING_REVIEW' }],
    ['reddedilen', { status: 'REJECTED' }],
    ['inceleme kaydi olmayan', null],
    ['bilinmeyen durumdaki', { status: 'UNKNOWN' }],
    ['durumu eksik', {}],
  ];

  for (const [label, fileReview] of blockedReviewCases) {
    it(`${label} dosya icin indirme baglantisi olusturmaz`, async () => {
      findUnique.mockResolvedValue({
        ...validMessage,
        fileReview,
      });

      await expect(
        service.getDownload(user, 'thread-a', 'message-a'),
      ).rejects.toThrow(NotFoundException);

      expect(assertThreadAccess).toHaveBeenCalledWith(
        user,
        'thread-a',
      );

      expect(createChatDownloadUrl).not.toHaveBeenCalled();
    });
  }

});
