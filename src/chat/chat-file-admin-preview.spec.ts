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
import { ChatFileAccessService } from './chat-file-access.service';

describe('Admin pending file preview security', () => {
  const findUnique = jest.fn();
  const createAudit = jest.fn();
  const sign = jest.fn();

  const service = new ChatFileAccessService(
    {
      chatFileReview: { findUnique },
      auditLog: { create: createAudit },
    } as any,
    {} as any,
    {
      createChatDownloadUrl: sign,
    } as any,
  );

  const admin = {
    id: 'admin-1',
    role: Role.ADMIN,
    companyId: null,
  };

  const validReview = {
    status: 'PENDING_REVIEW',
    message: {
      isFlagged: false,
      fileUrl:
        'chat-private:tedarik-pazari-platform/chat/private123.pdf',
      fileType: 'application/pdf',
    },
  };

  beforeEach(() => {
    findUnique.mockReset();
    createAudit.mockReset();
    sign.mockReset();

    findUnique.mockResolvedValue(validReview);
    createAudit.mockResolvedValue({ id: 'audit-1' });
    sign.mockReturnValue({
      url: 'https://res.cloudinary.com/mock/signed',
      expiresAt: '2026-11-12T21:00:00Z',
    });
  });

  it('yalniz ADMIN rolune izin verir', async () => {
    for (const role of [
      Role.BUYER,
      Role.SELLER,
      Role.LOGISTICS,
    ]) {
      await expect(
        service.getAdminReviewDownload(
          { id: 'user-1', role },
          'review-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(findUnique).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });

  it('kimligi olmayan ADMIN istegini reddeder', async () => {
    await expect(
      service.getAdminReviewDownload(
        { role: Role.ADMIN },
        'review-1',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('gecersiz inceleme kimligini reddeder', async () => {
    for (const id of [
      '',
      ' ',
      '../secret',
      'x'.repeat(129),
      null,
      123,
    ]) {
      await expect(
        service.getAdminReviewDownload(admin, id as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('yalniz gerekli dosya alanlarini sorgular', async () => {
    await service.getAdminReviewDownload(
      admin,
      'review-1',
    );

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      select: {
        status: true,
        message: {
          select: {
            isFlagged: true,
            fileUrl: true,
            fileType: true,
          },
        },
      },
    });
  });

  it('bekleyen PDF icin sureli baglanti verir', async () => {
    const result = await service.getAdminReviewDownload(
      admin,
      'review-1',
    );

    expect(sign).toHaveBeenCalledWith(
      'tedarik-pazari-platform/chat/private123.pdf',
      'raw',
      'pdf',
    );

    expect(result).toEqual({
      url: 'https://res.cloudinary.com/mock/signed',
      expiresAt: '2026-11-12T21:00:00Z',
      fileName: 'Belge.pdf',
    });

    expect(JSON.stringify(result)).not.toContain(
      'private123',
    );
  });

  it('APPROVED REJECTED ve bilinmeyen durumlari reddeder', async () => {
    for (const status of [
      'APPROVED',
      'REJECTED',
      'UNKNOWN',
    ]) {
      findUnique.mockResolvedValue({
        ...validReview,
        status,
      });

      await expect(
        service.getAdminReviewDownload(
          admin,
          'review-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    }

    expect(sign).not.toHaveBeenCalled();
  });

  it('kaydi olmayan veya flagli dosyayi reddeder', async () => {
    for (const review of [
      null,
      { status: 'PENDING_REVIEW', message: null },
      {
        ...validReview,
        message: {
          ...validReview.message,
          isFlagged: true,
        },
      },
    ]) {
      findUnique.mockResolvedValue(review);

      await expect(
        service.getAdminReviewDownload(
          admin,
          'review-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    }

    expect(sign).not.toHaveBeenCalled();
  });

  it('gecersiz ozel depolama referansini reddeder', async () => {
    for (const fileUrl of [
      'https://example.com/file.pdf',
      'chat-private:../secret',
      'chat-private:',
      'chat-private:other-folder/private.pdf',
    ]) {
      findUnique.mockResolvedValue({
        ...validReview,
        message: {
          ...validReview.message,
          fileUrl,
        },
      });

      await expect(
        service.getAdminReviewDownload(
          admin,
          'review-1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    }

    expect(sign).not.toHaveBeenCalled();
  });

  it('desteklenmeyen dosya turunu reddeder', async () => {
    findUnique.mockResolvedValue({
      ...validReview,
      message: {
        ...validReview.message,
        fileType: 'text/html',
      },
    });

    await expect(
      service.getAdminReviewDownload(
        admin,
        'review-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(sign).not.toHaveBeenCalled();
  });

  it('PDF referansini gorsel olarak acmaz', async () => {
    findUnique.mockResolvedValue({
      ...validReview,
      message: {
        ...validReview.message,
        fileType: 'image/png',
      },
    });

    await expect(
      service.getAdminReviewDownload(
        admin,
        'review-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(sign).not.toHaveBeenCalled();
  });

  it('her basarili inceleme erisimini denetim kaydina yazar', async () => {
    await service.getAdminReviewDownload(
      admin,
      'review-1',
    );

    expect(createAudit).toHaveBeenCalledWith({
      data: {
        actorId: 'admin-1',
        actorRole: Role.ADMIN,
        actorCompanyId: null,
        action: 'CHAT_FILE_REVIEW_PREVIEW',
        entity: 'ChatFileReview',
        entityId: 'review-1',
        metadata: {
          status: 'PENDING_REVIEW',
        },
      },
    });
  });

  it('AuditLog hatasinda baglanti dondurmez', async () => {
    createAudit.mockRejectedValue(
      new Error('MOCK AUDIT ERROR'),
    );

    await expect(
      service.getAdminReviewDownload(
        admin,
        'review-1',
      ),
    ).rejects.toThrow('MOCK AUDIT ERROR');
  });

  it('imzali baglanti hatasinda denetim kaydi olusturmaz', async () => {
    sign.mockImplementation(() => {
      throw new Error('MOCK SIGN ERROR');
    });

    await expect(
      service.getAdminReviewDownload(
        admin,
        'review-1',
      ),
    ).rejects.toThrow('MOCK SIGN ERROR');

    expect(createAudit).not.toHaveBeenCalled();
  });
});
