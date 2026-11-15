import { assertChatFileContentScanReady } from './chat-file-content-scan-gate';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ChatService } from './chat.service';
import { isValidChatStorageReference } from './chat-file-storage.service';
import { canParticipantSeeChatMessage } from './chat-file-review-policy';

const PRIVATE_PREFIX = 'chat-private:';

const FILE_TYPES = {
  'application/pdf': {
    resourceType: 'raw',
    format: 'pdf',
    fileName: 'Belge.pdf',
  },
  'image/jpeg': {
    resourceType: 'image',
    format: 'jpg',
    fileName: 'Gorsel.jpg',
  },
  'image/png': {
    resourceType: 'image',
    format: 'png',
    fileName: 'Gorsel.png',
  },
  'image/webp': {
    resourceType: 'image',
    format: 'webp',
    fileName: 'Gorsel.webp',
  },
} as const;

@Injectable()
export class ChatFileAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async getDownload(
    user: any,
    threadId: string,
    messageId: string,
  ) {
    // Authorization must happen before querying file metadata.
    await this.chat.assertThreadAccess(user, threadId);

    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        threadId: true,
        fileUrl: true,
        fileType: true,
        isFlagged: true,
        fileReview: { select: { status: true } },
      },
    });

    if (
      !message ||
      message.threadId !== threadId ||
      !canParticipantSeeChatMessage(message) ||
      typeof message.fileUrl !== 'string' ||
      !message.fileUrl.startsWith(PRIVATE_PREFIX)
    ) {
      throw new NotFoundException('Sohbet dosyasi bulunamadi');
    }

    const publicId = message.fileUrl.slice(PRIVATE_PREFIX.length);

    if (!isValidChatStorageReference(publicId)) {
      throw new NotFoundException('Sohbet dosyasi bulunamadi');
    }

    const fileType = message.fileType;

    if (
      !fileType ||
      !Object.prototype.hasOwnProperty.call(FILE_TYPES, fileType)
    ) {
      throw new NotFoundException('Sohbet dosyasi bulunamadi');
    }

    const config = FILE_TYPES[fileType as keyof typeof FILE_TYPES];

    if (
      config.resourceType === 'image' &&
      publicId.endsWith('.pdf')
    ) {
      throw new NotFoundException('Sohbet dosyasi bulunamadi');
    }

    const signed = this.cloudinary.createChatDownloadUrl(
      publicId,
      config.resourceType,
      config.format,
    );

    return {
      url: signed.url,
      expiresAt: signed.expiresAt,
      fileName: config.fileName,
    };
  }

  async getAdminReviewDownload(user: any, reviewId: string) {
    // ADMIN authorization must precede metadata access.
    if (user?.role !== Role.ADMIN || !user?.id) {
      throw new ForbiddenException(
        'Sadece ADMIN dosya inceleyebilir',
      );
    }

    if (
      typeof reviewId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(reviewId)
    ) {
      throw new BadRequestException(
        'Gecersiz dosya inceleme kimligi',
      );
    }

    // Block preview before database or Cloudinary access.
    assertChatFileContentScanReady();

    const review = await this.prisma.chatFileReview.findUnique({
      where: { id: reviewId },
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

    if (
      !review ||
      review.status !== 'PENDING_REVIEW' ||
      !review.message ||
      review.message.isFlagged !== false ||
      typeof review.message.fileUrl !== 'string' ||
      !review.message.fileUrl.startsWith(PRIVATE_PREFIX)
    ) {
      throw new NotFoundException(
        'Inceleme bekleyen dosya bulunamadi',
      );
    }

    const publicId = review.message.fileUrl.slice(
      PRIVATE_PREFIX.length,
    );

    if (!isValidChatStorageReference(publicId)) {
      throw new NotFoundException(
        'Inceleme bekleyen dosya bulunamadi',
      );
    }

    const fileType = review.message.fileType;

    if (
      !fileType ||
      !Object.prototype.hasOwnProperty.call(
        FILE_TYPES,
        fileType,
      )
    ) {
      throw new NotFoundException(
        'Inceleme bekleyen dosya bulunamadi',
      );
    }

    const config = FILE_TYPES[
      fileType as keyof typeof FILE_TYPES
    ];

    if (
      config.resourceType === 'image' &&
      publicId.endsWith('.pdf')
    ) {
      throw new NotFoundException(
        'Inceleme bekleyen dosya bulunamadi',
      );
    }

    const signed = this.cloudinary.createChatDownloadUrl(
      publicId,
      config.resourceType,
      config.format,
    );

    // Fail closed if access cannot be audited.
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorRole: Role.ADMIN,
        actorCompanyId: user.companyId ?? null,
        action: 'CHAT_FILE_REVIEW_PREVIEW',
        entity: 'ChatFileReview',
        entityId: reviewId,
        metadata: {
          status: 'PENDING_REVIEW',
        },
      },
    });

    return {
      url: signed.url,
      expiresAt: signed.expiresAt,
      fileName: config.fileName,
    };
  }

}
