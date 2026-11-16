// Test-only mock: production scanning gate always rejects.
jest.mock('./chat-file-content-scan-gate', () => ({
  assertChatFileContentScanReady: jest.fn(),
}));

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ChatService } from './chat.service';

describe('Admin chat file decision security', () => {
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const createAudit = jest.fn();
  const findUsers = jest.fn();
  const createManyNotifications = jest.fn();
  const updateThread = jest.fn();
  const emitNewMessage = jest.fn();
  const emitFileReviewChanged = jest.fn();
  const createNotification = jest.fn();

  const tx = {
    chatFileReview: {
      findUnique,
      updateMany,
    },
    auditLog: {
      create: createAudit,
    },
    user: {
      findMany: findUsers,
    },
    notification: {
      createMany: createManyNotifications,
    },
    chatThread: {
      update: updateThread,
    },
  };

  const transaction = jest.fn(
    async (callback: any) => callback(tx),
  );

  const service = new ChatService(
    {
      $transaction: transaction,
      notification: {
        create: createNotification,
      },
    } as any,
    {
      emitNewMessage,
      emitChatFileReviewChanged: emitFileReviewChanged,
    } as any,
    {} as any,
  );

  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    companyId: null,
  };

  const validReview = {
    messageId: 'message-1',
    status: 'PENDING_REVIEW',
    message: {
      isFlagged: false,
      fileUrl:
        'chat-private:tedarik-pazari-platform/chat/private123.pdf',
      fileType: 'application/pdf',
      senderId: 'sender-1',
      threadId: 'thread-1',
      thread: {
        buyerId: 'buyer-company',
        sellerId: 'seller-company',
        logisticsId: 'logistics-company',
      },
    },
  };

  beforeEach(() => {
    findUnique.mockReset();
    updateMany.mockReset();
    createAudit.mockReset();
    findUsers.mockReset();
    createManyNotifications.mockReset();
    updateThread.mockReset();
    transaction.mockClear();
    emitNewMessage.mockReset();
    emitFileReviewChanged.mockReset();
    createNotification.mockReset();

    findUnique.mockResolvedValue(validReview);
    updateMany.mockResolvedValue({ count: 1 });
    createAudit.mockResolvedValue({ id: 'audit-1' });
    findUsers.mockResolvedValue([]);
    createManyNotifications.mockResolvedValue({ count: 0 });
    updateThread.mockResolvedValue({ id: 'thread-1' });
  });

  it('ADMIN dosyayi onaylar ve AuditLog kaydeder', async () => {
    const result = await service.reviewPendingChatFile(
      admin,
      'review-1',
      'APPROVED',
      'Kontrol edildi',
    );

    expect(result).toMatchObject({
      id: 'review-1',
      messageId: 'message-1',
      status: 'APPROVED',
      reviewedById: 'admin-1',
      reviewNote: 'Kontrol edildi',
    });

    expect(result.reviewedAt).toBeInstanceOf(Date);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'review-1',
        status: 'PENDING_REVIEW',
        message: {
          is: {
            isFlagged: false,
            fileUrl: validReview.message.fileUrl,
            fileType: 'application/pdf',
          },
        },
      },
      data: {
        status: 'APPROVED',
        reviewedAt: expect.any(Date),
        reviewedById: 'admin-1',
        reviewNote: 'Kontrol edildi',
      },
    });

    expect(createAudit).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-1',
        actorRole: Role.ADMIN,
        action: 'CHAT_FILE_REVIEW_DECISION',
        entity: 'ChatFileReview',
        entityId: 'review-1',
        metadata: {
          decision: 'APPROVED',
          messageId: 'message-1',
        },
      }),
    });
  });

  it('ADMIN dosyayi reddedebilir', async () => {
    const result = await service.reviewPendingChatFile(
      admin,
      'review-1',
      'REJECTED',
      'Uygun degil',
    );

    expect(result.status).toBe('REJECTED');

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'review-1',
        status: 'PENDING_REVIEW',
      },
      data: {
        status: 'REJECTED',
        reviewedAt: expect.any(Date),
        reviewedById: 'admin-1',
        reviewNote: 'Uygun degil',
      },
    });
  });

  it('BUYER SELLER LOGISTICS rollerini reddeder', async () => {
    for (const role of [
      Role.BUYER,
      Role.SELLER,
      Role.LOGISTICS,
    ]) {
      await expect(
        service.reviewPendingChatFile(
          { id: 'user-1', role },
          'review-1',
          'APPROVED',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(transaction).not.toHaveBeenCalled();
  });

  it('kimligi olmayan ADMIN istegini reddeder', async () => {
    await expect(
      service.reviewPendingChatFile(
        { role: Role.ADMIN },
        'review-1',
        'APPROVED',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('gecersiz kimlik ve karar degerlerini reddeder', async () => {
    for (const id of ['', '../secret', 'x'.repeat(129)]) {
      await expect(
        service.reviewPendingChatFile(
          admin,
          id,
          'APPROVED',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    for (const decision of [
      '',
      'PENDING_REVIEW',
      'NO_VIOLATION',
      'UNKNOWN',
    ]) {
      await expect(
        service.reviewPendingChatFile(
          admin,
          'review-1',
          decision,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(transaction).not.toHaveBeenCalled();
  });

  it('gecersiz veya uzun notlari reddeder', async () => {
    for (const note of [
      { secret: true },
      'x'.repeat(501),
    ]) {
      await expect(
        service.reviewPendingChatFile(
          admin,
          'review-1',
          'APPROVED',
          note,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(transaction).not.toHaveBeenCalled();
  });

  it('daha once incelenen dosyayi reddeder', async () => {
    for (const status of ['APPROVED', 'REJECTED']) {
      findUnique.mockResolvedValue({
        ...validReview,
        status,
      });

      await expect(
        service.reviewPendingChatFile(
          admin,
          'review-1',
          'APPROVED',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    }

    expect(updateMany).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('es zamanli ikinci karari engeller', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createAudit).not.toHaveBeenCalled();
  });

  it('guvensiz dosyayi onaylamaz', async () => {
    const cases = [
      {
        ...validReview.message,
        isFlagged: true,
      },
      {
        ...validReview.message,
        fileUrl: 'chat-private:../secret',
      },
      {
        ...validReview.message,
        fileUrl: 'https://example.com/file.pdf',
      },
      {
        ...validReview.message,
        fileType: 'text/html',
      },
      {
        ...validReview.message,
        fileType: 'image/png',
      },
    ];

    for (const message of cases) {
      findUnique.mockResolvedValue({
        ...validReview,
        message,
      });

      await expect(
        service.reviewPendingChatFile(
          admin,
          'review-1',
          'APPROVED',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(updateMany).not.toHaveBeenCalled();
    expect(createAudit).not.toHaveBeenCalled();
  });

  it('bozuk dosya referansini reddetmeye izin verir', async () => {
    findUnique.mockResolvedValue({
      ...validReview,
      message: {
        ...validReview.message,
        fileUrl: 'chat-private:../invalid',
      },
    });

    const result = await service.reviewPendingChatFile(
      admin,
      'review-1',
      'REJECTED',
    );

    expect(result.status).toBe('REJECTED');
  });

  it('AuditLog hatasini basari olarak gostermez', async () => {
    createAudit.mockRejectedValue(
      new Error('MOCK AUDIT ERROR'),
    );

    await expect(
      service.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
      ),
    ).rejects.toThrow('MOCK AUDIT ERROR');
  });

  it('karar sirasinda erken bildirim veya socket gondermez', async () => {
    await service.reviewPendingChatFile(
      admin,
      'review-1',
      'APPROVED',
    );

    expect(createNotification).not.toHaveBeenCalled();
    expect(emitNewMessage).not.toHaveBeenCalled();
  });

  it('yalniz ilgili sirket rollerine bildirim arar', async () => {
    await service.reviewPendingChatFile(
      admin,
      'review-1',
      'APPROVED',
    );

    expect(findUsers).toHaveBeenCalledWith({
      where: {
        id: { not: 'sender-1' },
        OR: [
          {
            companyId: 'buyer-company',
            role: Role.BUYER,
          },
          {
            companyId: 'seller-company',
            role: Role.SELLER,
          },
          {
            companyId: 'logistics-company',
            role: Role.LOGISTICS,
          },
        ],
      },
      select: { id: true },
    });
  });

  it('tekrarlanan alicilari ve gondereni bildirimden cikarir', async () => {
    findUsers.mockResolvedValue([
      { id: 'buyer-user' },
      { id: 'seller-user' },
      { id: 'buyer-user' },
      { id: 'sender-1' },
      { id: '' },
    ]);

    await service.reviewPendingChatFile(
      admin,
      'review-1',
      'APPROVED',
    );

    expect(createManyNotifications).toHaveBeenCalledWith({
      data: [
        {
          userId: 'buyer-user',
          type: 'SYSTEM',
          title: 'Yeni sohbet dosyasi',
          message: 'Sohbetinize onaylanmis bir dosya eklendi.',
          link: '/chat',
        },
        {
          userId: 'seller-user',
          type: 'SYSTEM',
          title: 'Yeni sohbet dosyasi',
          message: 'Sohbetinize onaylanmis bir dosya eklendi.',
          link: '/chat',
        },
      ],
    });

    const payload = JSON.stringify(
      createManyNotifications.mock.calls[0][0],
    );

    expect(payload).not.toContain('private123');
    expect(payload).not.toContain('chat-private:');
    expect(payload).not.toContain('sender-1');
  });

  it('alici yoksa bos bildirim toplu kaydi yapmaz', async () => {
    await service.reviewPendingChatFile(
      admin,
      'review-1',
      'APPROVED',
    );

    expect(createManyNotifications).not.toHaveBeenCalled();

    expect(updateThread).toHaveBeenCalledWith({
      where: { id: 'thread-1' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('reddedilen dosyayi katilimcilara bildirmez', async () => {
    await service.reviewPendingChatFile(
      admin,
      'review-1',
      'REJECTED',
    );

    expect(findUsers).not.toHaveBeenCalled();
    expect(createManyNotifications).not.toHaveBeenCalled();
    expect(updateThread).not.toHaveBeenCalled();
    expect(emitNewMessage).not.toHaveBeenCalled();
  });

  it('bildirim veritabani hatasini basari saymaz', async () => {
    findUsers.mockResolvedValue([{ id: 'buyer-user' }]);

    createManyNotifications.mockRejectedValue(
      new Error('MOCK NOTIFICATION ERROR'),
    );

    await expect(
      service.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
      ),
    ).rejects.toThrow('MOCK NOTIFICATION ERROR');

    expect(updateThread).not.toHaveBeenCalled();
    expect(emitNewMessage).not.toHaveBeenCalled();
  });

  it('es zamanli ikinci karar bildirim olusturmaz', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(findUsers).not.toHaveBeenCalled();
    expect(createManyNotifications).not.toHaveBeenCalled();
    expect(updateThread).not.toHaveBeenCalled();
  });

  it('sohbet iliskisi bozuksa bildirim olusturmaz', async () => {
    findUnique.mockResolvedValue({
      ...validReview,
      message: {
        ...validReview.message,
        thread: null,
      },
    });

    await expect(
      service.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(findUsers).not.toHaveBeenCalled();
    expect(createManyNotifications).not.toHaveBeenCalled();
    expect(updateThread).not.toHaveBeenCalled();
  });

  it('sohbet guncelleme hatasini gizlemez', async () => {
    updateThread.mockRejectedValue(
      new Error('MOCK THREAD UPDATE ERROR'),
    );

    await expect(
      service.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
      ),
    ).rejects.toThrow('MOCK THREAD UPDATE ERROR');

    expect(emitNewMessage).not.toHaveBeenCalled();
  });

  it('onay sinyalini yalniz transaction tamamlaninca gonderir', async () => {
    transaction.mockImplementationOnce(async (callback: any) => {
      const result = await callback(tx);

      expect(emitFileReviewChanged).not.toHaveBeenCalled();

      return result;
    });

    const result = await service.reviewPendingChatFile(
      admin,
      'review-1',
      'APPROVED',
    );

    expect(result.status).toBe('APPROVED');
    expect(emitFileReviewChanged).toHaveBeenCalledTimes(1);
    expect(emitFileReviewChanged).toHaveBeenCalledWith(
      'thread-1',
      'sender-1',
      'APPROVED',
    );
  });

  it('ret kararini yalniz gonderici sinyali olarak iletir', async () => {
    const result = await service.reviewPendingChatFile(
      admin,
      'review-1',
      'REJECTED',
    );

    expect(result.status).toBe('REJECTED');
    expect(emitFileReviewChanged).toHaveBeenCalledWith(
      'thread-1',
      'sender-1',
      'REJECTED',
    );
  });

  it('transaction hatasinda socket sinyali gondermez', async () => {
    createAudit.mockRejectedValue(
      new Error('MOCK AUDIT FAILURE'),
    );

    await expect(
      service.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
      ),
    ).rejects.toThrow('MOCK AUDIT FAILURE');

    expect(emitFileReviewChanged).not.toHaveBeenCalled();
  });

  it('socket hatasi veritabaninda tamamlanan karari bozmaz', async () => {
    emitFileReviewChanged.mockImplementation(() => {
      throw new Error('MOCK SOCKET FAILURE');
    });

    const result = await service.reviewPendingChatFile(
      admin,
      'review-1',
      'APPROVED',
    );

    expect(result.status).toBe('APPROVED');
    expect(createAudit).toHaveBeenCalledTimes(1);
    expect(updateThread).toHaveBeenCalledTimes(1);
  });

});
