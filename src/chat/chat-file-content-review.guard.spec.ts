import {
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ChatFileContentReviewGuard,
} from './chat-file-content-review.guard';

describe('Chat file content review safety lock', () => {
  const guard = new ChatFileContentReviewGuard();

  it('icerik moderasyonu hazir degilse HTTP 503 verir', () => {
    expect(() => guard.canActivate()).toThrow(
      ServiceUnavailableException,
    );

    try {
      guard.canActivate();
    } catch (error) {
      expect(
        (error as ServiceUnavailableException).getStatus(),
      ).toBe(503);
    }
  });

  it('ortam degiskenleriyle kilit acilamaz', () => {
    const oldUpload = process.env.CHAT_FILE_UPLOADS_ENABLED;
    const oldReview = process.env.CHAT_FILE_CONTENT_REVIEW_READY;

    try {
      process.env.CHAT_FILE_UPLOADS_ENABLED = 'true';
      process.env.CHAT_FILE_CONTENT_REVIEW_READY = 'true';

      expect(() => guard.canActivate()).toThrow(
        ServiceUnavailableException,
      );
    } finally {
      if (oldUpload === undefined) {
        delete process.env.CHAT_FILE_UPLOADS_ENABLED;
      } else {
        process.env.CHAT_FILE_UPLOADS_ENABLED = oldUpload;
      }

      if (oldReview === undefined) {
        delete process.env.CHAT_FILE_CONTENT_REVIEW_READY;
      } else {
        process.env.CHAT_FILE_CONTENT_REVIEW_READY = oldReview;
      }
    }
  });
});
