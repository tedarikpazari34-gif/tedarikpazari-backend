import { ServiceUnavailableException } from '@nestjs/common';
import { ChatController } from './chat.controller';

describe('Chat file HTTP safety lock', () => {
  const reviewPendingChatFile = jest.fn();
  const getAdminReviewDownload = jest.fn();
  const listPendingFileReviews = jest.fn();

  const controller = Object.create(
    ChatController.prototype,
  ) as ChatController;

  const request = {
    user: {
      id: 'admin-1',
      role: 'ADMIN',
    },
  };

  beforeEach(() => {
    reviewPendingChatFile.mockReset();
    getAdminReviewDownload.mockReset();
    listPendingFileReviews.mockReset();

    (controller as any).chatService = {
      reviewPendingChatFile,
      listPendingFileReviews,
    };

    (controller as any).chatFileAccess = {
      getAdminReviewDownload,
    };
  });

  it('APPROVED karari HTTP seviyesinde engellenir', () => {
    expect(() =>
      controller.reviewPendingChatFile(
        request,
        'review-1',
        { decision: 'APPROVED' },
      ),
    ).toThrow(ServiceUnavailableException);

    expect(reviewPendingChatFile).not.toHaveBeenCalled();
  });

  it('onizleme HTTP seviyesinde engellenir', () => {
    expect(() =>
      controller.previewPendingChatFile(
        request,
        'review-1',
      ),
    ).toThrow(ServiceUnavailableException);

    expect(getAdminReviewDownload).not.toHaveBeenCalled();
  });

  it('gerekceli ret karari backend servisine iletilir', () => {
    reviewPendingChatFile.mockReturnValue({
      id: 'review-1',
      status: 'REJECTED',
    });

    const result = controller.reviewPendingChatFile(
      request,
      'review-1',
      {
        decision: 'REJECTED',
        note: 'Guvenlik nedeniyle reddedildi',
      },
    );

    expect(result).toEqual({
      id: 'review-1',
      status: 'REJECTED',
    });

    expect(reviewPendingChatFile).toHaveBeenCalledWith(
      request.user,
      'review-1',
      'REJECTED',
      'Guvenlik nedeniyle reddedildi',
    );
  });

  it('bekleyen dosya listesi korunur', () => {
    listPendingFileReviews.mockReturnValue({
      items: [],
      nextCursor: null,
    });

    const result = controller.listPendingFileReviews(
      request,
      undefined,
    );

    expect(result).toEqual({
      items: [],
      nextCursor: null,
    });

    expect(listPendingFileReviews).toHaveBeenCalledWith(
      request.user,
      undefined,
    );
  });

  it('onay kilidi dosya bilgilerini servise iletmez', () => {
    expect(() =>
      controller.reviewPendingChatFile(
        request,
        'review-secret',
        {
          decision: 'APPROVED',
          note: 'private admin note',
        },
      ),
    ).toThrow(ServiceUnavailableException);

    expect(reviewPendingChatFile).not.toHaveBeenCalled();
    expect(getAdminReviewDownload).not.toHaveBeenCalled();
  });
});
