import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatFileAccessService } from './chat-file-access.service';
import { assertChatFileContentScanReady } from './chat-file-content-scan-gate';

describe('Chat file service-level scanning lock', () => {
  const admin = {
    id: 'admin-1',
    role: 'ADMIN',
  };

  const createServices = () => {
    const transaction = jest.fn();
    const findUnique = jest.fn();
    const createChatDownloadUrl = jest.fn();

    const chat = Object.create(
      ChatService.prototype,
    ) as ChatService;

    const access = Object.create(
      ChatFileAccessService.prototype,
    ) as ChatFileAccessService;

    (chat as any).prisma = {
      $transaction: transaction,
    };

    (access as any).prisma = {
      chatFileReview: { findUnique },
    };

    (access as any).cloudinary = {
      createChatDownloadUrl,
    };

    return {
      chat,
      access,
      transaction,
      findUnique,
      createChatDownloadUrl,
    };
  };

  it('guvenlik kapisi her zaman kapali', () => {
    expect(() =>
      assertChatFileContentScanReady(),
    ).toThrow(ServiceUnavailableException);
  });

  it('dogrudan servis onayi engellenir', async () => {
    const { chat, transaction } = createServices();

    await expect(
      chat.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
      ),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('onay notuyla kilit asilamaz', async () => {
    const { chat, transaction } = createServices();

    await expect(
      chat.reviewPendingChatFile(
        admin,
        'review-1',
        'APPROVED',
        'Admin approved',
      ),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('dogrudan servis onizlemesi engellenir', async () => {
    const {
      access,
      findUnique,
      createChatDownloadUrl,
    } = createServices();

    await expect(
      access.getAdminReviewDownload(
        admin,
        'review-1',
      ),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(findUnique).not.toHaveBeenCalled();
    expect(createChatDownloadUrl).not.toHaveBeenCalled();
  });

  it('ret islemi guvenlik kapisindan etkilenmez', async () => {
    const { chat, transaction } = createServices();

    transaction.mockRejectedValue(
      new Error('MOCK TRANSACTION STOP'),
    );

    await expect(
      chat.reviewPendingChatFile(
        admin,
        'review-1',
        'REJECTED',
        'Guvenlik nedeniyle ret',
      ),
    ).rejects.toThrow('MOCK TRANSACTION STOP');

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('yetkisiz kullanici onay isteyemez', async () => {
    const { chat, transaction } = createServices();

    await expect(
      chat.reviewPendingChatFile(
        { id: 'buyer-1', role: 'BUYER' },
        'review-1',
        'APPROVED',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('yetkisiz kullanici onizleme isteyemez', async () => {
    const { access, findUnique } = createServices();

    await expect(
      access.getAdminReviewDownload(
        { id: 'buyer-1', role: 'BUYER' },
        'review-1',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('gecersiz kimlik onay servisinde reddedilir', async () => {
    const { chat, transaction } = createServices();

    await expect(
      chat.reviewPendingChatFile(
        admin,
        '../secret',
        'APPROVED',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('gecersiz kimlik onizleme servisinde reddedilir', async () => {
    const { access, findUnique } = createServices();

    await expect(
      access.getAdminReviewDownload(
        admin,
        '../secret',
      ),
    ).rejects.toThrow(BadRequestException);

    expect(findUnique).not.toHaveBeenCalled();
  });
});
