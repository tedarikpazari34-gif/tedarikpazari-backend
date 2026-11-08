
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { ChatService } from './chat.service';

describe('Chat moderation review security', () => {
  let service: ChatService;
  let prisma: any;
  let tx: any;

  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    companyId: 'company-1',
  };

  beforeEach(() => {
    tx = {
      chatMessage: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };

    prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };

    service = new ChatService(
      prisma as any,
      {} as any,
      {} as any,
    );
  });

  it('ADMIN kararını ve inceleme tarihini kaydeder', async () => {
    const result = await service.reviewFlaggedMessage(
      admin,
      'message-1',
      'VIOLATION_CONFIRMED',
      'Telefon numarası paylaşımı',
    );

    expect(result.reviewDecision).toBe('VIOLATION_CONFIRMED');
    expect(result.reviewedById).toBe(admin.id);
    expect(result.reviewedAt).toBeInstanceOf(Date);

    expect(tx.chatMessage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'message-1',
        isFlagged: true,
        reviewedAt: null,
      },
      data: {
        reviewedAt: expect.any(Date),
        reviewedById: admin.id,
        reviewDecision: 'VIOLATION_CONFIRMED',
        reviewNote: 'Telefon numarası paylaşımı',
      },
    });
  });

  it('İhlal yok kararını kabul eder', async () => {
    const result = await service.reviewFlaggedMessage(
      admin,
      'message-1',
      'NO_VIOLATION',
    );

    expect(result.reviewDecision).toBe('NO_VIOLATION');
    expect(result.reviewNote).toBeNull();
  });

  it('BUYER ve SELLER yetkisini reddeder', async () => {
    for (const role of [Role.BUYER, Role.SELLER]) {
      await expect(
        service.reviewFlaggedMessage(
          { id: 'user-1', role },
          'message-1',
          'NO_VIOLATION',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('Kimliği olmayan ADMIN isteğini reddeder', async () => {
    await expect(
      service.reviewFlaggedMessage(
        { role: Role.ADMIN },
        'message-1',
        'NO_VIOLATION',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Geçersiz karar ve mesaj kimliğini reddeder', async () => {
    await expect(
      service.reviewFlaggedMessage(
        admin, 'message-1', 'APPROVED',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.reviewFlaggedMessage(
        admin, '', 'NO_VIOLATION',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('Geçersiz ve uzun notları reddeder', async () => {
    for (const note of [{ x: 1 }, 'x'.repeat(501)]) {
      await expect(
        service.reviewFlaggedMessage(
          admin, 'message-1', 'NO_VIOLATION', note,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('Daha önce incelenmiş mesajın yeniden işlenmesini engeller', async () => {
    tx.chatMessage.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.reviewFlaggedMessage(
        admin, 'message-1', 'NO_VIOLATION',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('Başarılı inceleme için AuditLog oluşturur', async () => {
    await service.reviewFlaggedMessage(
      admin, 'message-1', 'VIOLATION_CONFIRMED',
    );

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: admin.id,
        actorRole: Role.ADMIN,
        action: 'CHAT_MODERATION_REVIEW',
        entity: 'ChatMessage',
        entityId: 'message-1',
        metadata: {
          decision: 'VIOLATION_CONFIRMED',
        },
      }),
    });
  });

  it('AuditLog hatasını gizlemez', async () => {
    tx.auditLog.create.mockRejectedValue(
      new Error('AuditLog write failed'),
    );

    await expect(
      service.reviewFlaggedMessage(
        admin, 'message-1', 'NO_VIOLATION',
      ),
    ).rejects.toThrow('AuditLog write failed');
  });
});
