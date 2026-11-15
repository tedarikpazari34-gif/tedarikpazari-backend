import { assertChatFileContentScanReady } from './chat-file-content-scan-gate';
import { isValidChatStorageReference } from './chat-file-storage.service';
import { participantVisibleChatMessageWhere } from './chat-file-review-policy';
import { ChatFileStorageService } from './chat-file-storage.service';
import {
  toPublicChatMessage,
  toPublicChatThread,
} from './chat-message-public';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Optional,
  NotFoundException,
} from '@nestjs/common';

import { ChatThreadType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { normalizeChatLanguage } from './chat-translation.policy';
import { ChatTranslationService } from './chat-translation.service';
import { hasForbiddenChatContactInfo } from './chat-contact-policy';
import { MailService } from '../mail/mail.service';

@Injectable()
export class ChatService {
  private readonly chatTranslation = new ChatTranslationService();
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatGateway: ChatGateway,
    private readonly mailService: MailService,
    @Optional() private readonly injectedChatTranslation?: ChatTranslationService,
    @Optional() private readonly injectedChatFileStorage?: ChatFileStorageService,
  ) {}

  private hasForbiddenContactInfo(content: string) {
    return hasForbiddenChatContactInfo(content);
  }

  private async canAccessThread(user: any, threadId: string) {
    const thread = await this.prisma.chatThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        logisticsId: true,
      },
    });

    if (!thread) {
      throw new NotFoundException('Chat bulunamadı');
    }

    const isAdmin = user?.role === Role.ADMIN;
    const companyId = user?.companyId || null;
    const isBuyer =
      user?.role === Role.BUYER && !!companyId && thread.buyerId === companyId;
    const isSeller =
      user?.role === Role.SELLER && !!companyId && thread.sellerId === companyId;
    const isLogistics =
      user?.role === Role.LOGISTICS && !!companyId && thread.logisticsId === companyId;

    if (!isAdmin && !isBuyer && !isSeller && !isLogistics) {
      throw new ForbiddenException('Bu chate erişemezsiniz');
    }

    return thread;
  }

  async assertThreadAccess(
    user: any,
    threadId: string,
  ): Promise<void> {
    await this.canAccessThread(user, threadId);
  }

  async createThreadForRfq(user: any, rfqId: string) {
    const rfq = await this.prisma.rFQ.findUnique({
      where: { id: rfqId },
      include: {
        product: true,
      },
    });

    if (!rfq || !rfq.product) {
      throw new NotFoundException('RFQ bulunamadı');
    }

    if (user.role !== Role.BUYER && user.role !== Role.SELLER) {
      throw new ForbiddenException('Chat başlatamazsınız');
    }

    const buyerId = rfq.buyerId;
    const sellerId = rfq.product.sellerId;

    if (user.companyId !== buyerId && user.companyId !== sellerId) {
      throw new ForbiddenException('Bu RFQ için chat açamazsınız');
    }

    const existingThread = await this.prisma.chatThread.findFirst({
      where: {
        rfqId,
        buyerId,
        sellerId,
      },
      include: {
        buyer: { select: { id: true } },
        seller: { select: { id: true } },
        logistics: { select: { id: true } },
        shippingOrder: { select: { trackingNo: true } },
        rfq: {
          select: {
            id: true,
            product: { select: { title: true } },
          },
        },
      },
    });

    if (existingThread) {
      return existingThread;
    }

    return this.prisma.chatThread.create({
      data: {
        type: ChatThreadType.RFQ,
        rfqId,
        buyerId,
        sellerId,
      },
      include: {
        buyer: { select: { id: true } },
        seller: { select: { id: true } },
        logistics: { select: { id: true } },
        shippingOrder: { select: { trackingNo: true } },
        rfq: {
          select: {
            id: true,
            product: { select: { title: true } },
          },
        },
      },
    });
  }

  async createThreadForOrder(user: any, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Sipariş bulunamadı');
    }

    if (user.role !== Role.BUYER && user.role !== Role.SELLER) {
      throw new ForbiddenException('Chat başlatamazsınız');
    }

    const buyerId = order.buyerId;
    const sellerId = order.sellerId;

    if (user.companyId !== buyerId && user.companyId !== sellerId) {
      throw new ForbiddenException('Bu sipariş için chat açamazsınız');
    }

    const existingThread = await this.prisma.chatThread.findFirst({
      where: {
        orderId,
        buyerId,
        sellerId,
      },
      include: {
        buyer: { select: { id: true } },
        seller: { select: { id: true } },
        order: { select: { id: true } },
      },
    });

    if (existingThread) {
      return existingThread;
    }

    return this.prisma.chatThread.create({
      data: {
        type: ChatThreadType.ORDER,
        orderId,
        buyerId,
        sellerId,
      },
      include: {
        buyer: { select: { id: true } },
        seller: { select: { id: true } },
        order: { select: { id: true } },
      },
    });
  }

  async listMine(user: any) {
    if (user.role === Role.ADMIN) {
      const threads = await this.prisma.chatThread.findMany({
        orderBy: { updatedAt: 'desc' },
        include: {
          buyer: { select: { id: true } },
          seller: { select: { id: true } },
          logistics: { select: { id: true } },
          shippingOrder: {
            select: { id: true, trackingNo: true },
          },
          rfq: {
            select: {
              id: true,
              product: { select: { title: true } },
            },
          },
          order: { select: { id: true } },
          messages: {
            where: {
              isFlagged: false,
              ...participantVisibleChatMessageWhere,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              threadId: true,
              senderId: true,
              content: true,
              createdAt: true,
              isRead: true,
              fileUrl: true,
              fileName: true,
              fileType: true,
            },
          },
        },
      });
      return threads.map(toPublicChatThread);
    }

    if (
      !user?.companyId ||
      ![Role.BUYER, Role.SELLER, Role.LOGISTICS].includes(user.role)
    ) {
      throw new ForbiddenException('Sohbetlere erişim yetkiniz yok');
    }

    const threads = await this.prisma.chatThread.findMany({
      where:
        user.role === Role.BUYER
          ? { buyerId: user.companyId }
          : user.role === Role.SELLER
            ? { sellerId: user.companyId }
            : { logisticsId: user.companyId },
      orderBy: { updatedAt: 'desc' },
      include: {
        buyer: { select: { id: true } },
        seller: { select: { id: true } },
        rfq: {
          select: {
            id: true,
            product: { select: { title: true } },
          },
        },
        order: { select: { id: true } },
        messages: {
          where: {
            isFlagged: false,
            ...participantVisibleChatMessageWhere,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    return threads.map(toPublicChatThread);
  }

  async listMyChatFileReviews(user: any, threadId: string) {
    if (
      typeof user?.id !== 'string' ||
      !user.id.trim()
    ) {
      throw new ForbiddenException(
        'Kullanici kimligi dogrulanamadi',
      );
    }

    if (
      typeof threadId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(threadId)
    ) {
      throw new BadRequestException(
        'Gecersiz sohbet kimligi',
      );
    }

    // Thread authorization must happen before file queries.
    await this.canAccessThread(user, threadId);

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        threadId,
        senderId: user.id,
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

    const safeNames: Record<string, string> = {
      'application/pdf': 'Belge.pdf',
      'image/jpeg': 'Gorsel.jpg',
      'image/png': 'Gorsel.png',
      'image/webp': 'Gorsel.webp',
    };

    const allowedStatuses = new Set([
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED',
    ]);

    return {
      items: messages.slice(0, 50).flatMap((message) => {
        const status = message.fileReview?.status;

        if (!status || !allowedStatuses.has(status)) {
          return [];
        }

        return [{
          id: message.id,
          createdAt: message.createdAt,
          fileName: safeNames[message.fileType ?? ''] ?? 'Dosya',
          status,
        }];
      }),
    };
  }

  async getMessages(user: any, threadId: string, language?: string) {
    const targetLanguage = normalizeChatLanguage(language);
    await this.canAccessThread(user, threadId);

    await this.prisma.chatMessage.updateMany({
      where: {
        threadId,
        isRead: false,
        isFlagged: false,
        ...participantVisibleChatMessageWhere,
        NOT: {
          senderId: user.id,
        },
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        threadId,
        isFlagged: false,
        ...participantVisibleChatMessageWhere,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        sender: {
          select: {
            id: true,
            role: true,
            companyId: true,
          },
        },
      },
    });
    const safeMessages = messages.map(toPublicChatMessage);
    if (!targetLanguage) return safeMessages;

    return Promise.all(
      safeMessages.map(async (message) => {
        if (message.fileUrl) {
          return {
            ...message,
            translatedContent: null,
            translationLanguage: targetLanguage,
            translationStatus: 'SKIPPED' as const,
          };
        }

        if (this.hasForbiddenContactInfo(message.content)) {
          return {
            ...message,
            translatedContent: null,
            translationLanguage: targetLanguage,
            translationStatus: 'SKIPPED' as const,
          };
        }

        const translation = await (this.injectedChatTranslation ?? this.chatTranslation).translateMessage(
          message,
          targetLanguage,
        );

        // Eski önbellek kayıtları dahil, güvenli olmayan çeviri gösterilmez.
        if (
          translation.translatedContent &&
          this.hasForbiddenContactInfo(translation.translatedContent)
        ) {
          return {
            ...message,
            translatedContent: null,
            translationLanguage: targetLanguage,
            translationStatus: 'SKIPPED' as const,
          };
        }

        return { ...message, ...translation };
      }),
    );
  }

  async listFlaggedMessages(user: any) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Sadece ADMIN erişebilir');
    }

    const flagged = await this.prisma.chatMessage.findMany({
      where: {
        isFlagged: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            role: true,
            companyId: true,
          },
        },
        thread: {
          include: {
            buyer: { select: { id: true } },
            seller: { select: { id: true } },
            rfq: {
              select: {
                id: true,
                product: { select: { title: true } },
              },
            },
            order: { select: { id: true } },
          },
        },
      },
    });
    return flagged.map(toPublicChatMessage);
  }

  async listPendingFileReviews(user: any, cursor?: unknown) {
    if (user?.role !== Role.ADMIN || !user?.id) {
      throw new ForbiddenException('Sadece ADMIN dosyalari inceleyebilir');
    }

    if (
      cursor !== undefined &&
      (typeof cursor !== 'string' ||
        !cursor.trim() ||
        cursor.length > 128)
    ) {
      throw new BadRequestException('Gecersiz sayfalama kimligi');
    }

    const normalizedCursor =
      typeof cursor === 'string' ? cursor.trim() : undefined;

    const reviews = await this.prisma.chatFileReview.findMany({
      where: {
        status: 'PENDING_REVIEW',
        message: {
          is: {
            isFlagged: false,
            fileUrl: { startsWith: 'chat-private:' },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 51,
      ...(normalizedCursor
        ? { skip: 1, cursor: { id: normalizedCursor } }
        : {}),
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

    const page = reviews.slice(0, 50);
    const allowedFileTypes = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);

    return {
      items: page.map((review) => ({
        id: review.id,
        messageId: review.messageId,
        threadId: review.message.threadId,
        createdAt: review.createdAt,
        fileType: allowedFileTypes.has(review.message.fileType ?? '')
          ? review.message.fileType
          : null,
        status: 'PENDING_REVIEW' as const,
      })),
      nextCursor:
        reviews.length > 50 ? page[page.length - 1].id : null,
    };
  }

  async reviewPendingChatFile(
    user: any,
    reviewId: string,
    decision: string,
    note?: unknown,
  ) {
    if (
      user?.role !== Role.ADMIN ||
      typeof user?.id !== 'string' ||
      !user.id.trim()
    ) {
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

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new BadRequestException(
        'Gecersiz dosya inceleme karari',
      );
    }

    if (
      note !== undefined &&
      note !== null &&
      (typeof note !== 'string' || note.length > 500)
    ) {
      throw new BadRequestException(
        'Inceleme notu en fazla 500 karakter olabilir',
      );
    }

    const cleanNote =
      typeof note === 'string' ? note.trim() || null : null;

    // Direct service calls must not bypass the HTTP safety lock.
    if (decision === 'APPROVED') {
      assertChatFileContentScanReady();
    }

    const completed = await this.prisma.$transaction(async (tx) => {
      const review = await tx.chatFileReview.findUnique({
        where: { id: reviewId },
        select: {
          messageId: true,
          status: true,
          message: {
            select: {
              isFlagged: true,
              fileUrl: true,
              fileType: true,
              senderId: true,
              threadId: true,
              thread: {
                select: {
                  buyerId: true,
                  sellerId: true,
                  logisticsId: true,
                },
              },
            },
          },
        },
      });

      if (
        !review ||
        review.status !== 'PENDING_REVIEW' ||
        !review.message
      ) {
        throw new NotFoundException(
          'Bekleyen dosya bulunamadi veya daha once incelendi',
        );
      }

      const fileUrl = review.message.fileUrl;
      const fileType = review.message.fileType;

      if (decision === 'APPROVED') {
        const prefix = 'chat-private:';

        const publicId =
          typeof fileUrl === 'string' &&
          fileUrl.startsWith(prefix)
            ? fileUrl.slice(prefix.length)
            : null;

        const allowedTypes = new Set<string>([
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
        ]);

        if (
          review.message.isFlagged !== false ||
          !isValidChatStorageReference(publicId) ||
          !allowedTypes.has(fileType ?? '') ||
          (fileType !== 'application/pdf' &&
            publicId.endsWith('.pdf'))
        ) {
          throw new BadRequestException(
            'Dosya guvenlik dogrulamasindan gecemedi',
          );
        }
      }

      const reviewedAt = new Date();

      const updated = await tx.chatFileReview.updateMany({
        where: {
          id: reviewId,
          status: 'PENDING_REVIEW',
          ...(decision === 'APPROVED'
            ? {
                message: {
                  is: {
                    isFlagged: false,
                    fileUrl,
                    fileType,
                  },
                },
              }
            : {}),
        },
        data: {
          status: decision,
          reviewedAt,
          reviewedById: user.id,
          reviewNote: cleanNote,
        },
      });

      if (updated.count !== 1) {
        throw new NotFoundException(
          'Dosya daha once incelendi veya durumu degisti',
        );
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: Role.ADMIN,
          actorCompanyId: user.companyId ?? null,
          action: 'CHAT_FILE_REVIEW_DECISION',
          entity: 'ChatFileReview',
          entityId: reviewId,
          metadata: {
            decision,
            messageId: review.messageId,
          },
        },
      });

      if (decision === 'APPROVED') {
        const message = review.message;
        const thread = message.thread;

        if (
          !thread ||
          !message.threadId ||
          !message.senderId ||
          !thread.buyerId ||
          !thread.sellerId
        ) {
          throw new NotFoundException(
            'Dosyanin sohbet katilimcilari dogrulanamadi',
          );
        }

        const participantConditions = [
          {
            companyId: thread.buyerId,
            role: Role.BUYER,
          },
          {
            companyId: thread.sellerId,
            role: Role.SELLER,
          },
          ...(thread.logisticsId
            ? [{
                companyId: thread.logisticsId,
                role: Role.LOGISTICS,
              }]
            : []),
        ];

        const recipients = await tx.user.findMany({
          where: {
            id: { not: message.senderId },
            OR: participantConditions,
          },
          select: { id: true },
        });

        const recipientIds = [
          ...new Set(
            recipients
              .map((recipient) => recipient.id)
              .filter(
                (id) =>
                  typeof id === 'string' &&
                  id.length > 0 &&
                  id !== message.senderId,
              ),
          ),
        ];

        if (recipientIds.length > 0) {
          await tx.notification.createMany({
            data: recipientIds.map((userId) => ({
              userId,
              type: 'SYSTEM',
              title: 'Yeni sohbet dosyasi',
              message:
                'Sohbetinize onaylanmis bir dosya eklendi.',
              link: '/chat',
            })),
          });
        }

        // Only approved files update visible thread activity.
        // This update is part of the same transaction.
        await tx.chatThread.update({
          where: { id: message.threadId },
          data: { updatedAt: reviewedAt },
        });
      }

      return {
        response: {
          id: reviewId,
          messageId: review.messageId,
          status: decision,
          reviewedAt,
          reviewedById: user.id,
          reviewNote: cleanNote,
        },
        event: {
          threadId: review.message?.threadId ?? null,
          senderId: review.message?.senderId ?? null,
        },
      };
    });

    // Never emit before the database transaction commits.
    // Socket delivery is best-effort; persisted status is authoritative.
    try {
      this.chatGateway.emitChatFileReviewChanged(
        completed.event.threadId,
        completed.event.senderId,
        completed.response.status,
      );
    } catch {
      // A disconnected socket must not reverse a committed decision.
    }

    return completed.response;
  }

  async reviewFlaggedMessage(
    user: any,
    messageId: string,
    decision: string,
    note?: unknown,
  ) {
    if (user?.role !== Role.ADMIN || !user?.id) {
      throw new ForbiddenException('Sadece ADMIN inceleyebilir');
    }

    if (
      typeof messageId !== 'string' ||
      !messageId.trim() ||
      messageId.length > 128
    ) {
      throw new BadRequestException('Geçersiz mesaj kimliği');
    }

    if (
      decision !== 'VIOLATION_CONFIRMED' &&
      decision !== 'NO_VIOLATION'
    ) {
      throw new BadRequestException('Geçersiz moderasyon kararı');
    }

    if (
      note !== undefined &&
      note !== null &&
      (typeof note !== 'string' || note.trim().length > 500)
    ) {
      throw new BadRequestException('İnceleme notu en fazla 500 karakter olabilir');
    }

    const cleanNote =
      typeof note === 'string' ? note.trim() || null : null;

    return this.prisma.$transaction(async (tx) => {
      const reviewedAt = new Date();

      const updated = await tx.chatMessage.updateMany({
        where: {
          id: messageId,
          isFlagged: true,
          reviewedAt: null,
        },
        data: {
          reviewedAt,
          reviewedById: user.id,
          reviewDecision: decision,
          reviewNote: cleanNote,
        },
      });

      if (updated.count !== 1) {
        throw new NotFoundException(
          'İnceleme bekleyen mesaj bulunamadı veya daha önce incelendi',
        );
      }

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          actorRole: Role.ADMIN,
          actorCompanyId: user.companyId ?? null,
          action: 'CHAT_MODERATION_REVIEW',
          entity: 'ChatMessage',
          entityId: messageId,
          metadata: { decision },
        },
      });

      return {
        id: messageId,
        isFlagged: true,
        reviewedAt,
        reviewedById: user.id,
        reviewDecision: decision,
        reviewNote: cleanNote,
      };
    });
  }

  async getUnreadCount(user: any) {
    if (
      !user?.id ||
      (user.role !== Role.ADMIN &&
        (!user.companyId ||
          ![Role.BUYER, Role.SELLER, Role.LOGISTICS].includes(user.role)))
    ) {
      throw new ForbiddenException('Sohbetlere erişim yetkiniz yok');
    }

    return this.prisma.chatMessage.count({
      where: {
        isRead: false,
        isFlagged: false,
        ...participantVisibleChatMessageWhere,
        senderId: { not: user.id },
        ...(user.role === Role.ADMIN
          ? {}
          : {
              thread:
                user.role === Role.BUYER
                  ? { buyerId: user.companyId }
                  : user.role === Role.SELLER
                    ? { sellerId: user.companyId }
                    : { logisticsId: user.companyId },
            }),
      },
    });
  }
  async sendMessage(user: any, threadId: string, content: string) {
    const thread = await this.canAccessThread(user, threadId);

    if (!content || !content.trim()) {
      throw new BadRequestException('Mesaj boş olamaz');
    }

    const cleanContent = content.trim();
    const isFlagged = this.hasForbiddenContactInfo(cleanContent);

    if (isFlagged) {
      const flaggedMessage = await this.prisma.chatMessage.create({
        data: {
          threadId,
          senderId: user.id,
          content: cleanContent,
          isFlagged: true,
          isRead: true,
          readAt: new Date(),
        },
      });

      const adminUsers = await this.prisma.user.findMany({
        where: {
          role: Role.ADMIN,
        },
        select: {
          id: true,
        },
      });

      for (const admin of adminUsers) {
        const notification = await this.prisma.notification.create({
          data: {
            userId: admin.id,
            type: 'SYSTEM',
            title: 'Yasak İletişim Bilgisi Tespit Edildi',
            message:
              'Bir kullanıcı sohbet üzerinden telefon, e-posta veya bağlantı paylaşmayı denedi.',
            link: '/admin/control-center',
          },
        });

        this.chatGateway.emitNotificationToUser(admin.id, notification);
      }

      console.warn('FLAGGED CHAT MESSAGE:', {
        messageId: flaggedMessage.id,
        threadId,
        senderId: user.id,
      });

      throw new BadRequestException(
        'Platform dışı iletişim bilgisi, telefon, e-posta veya link paylaşımı yasaktır.',
      );
    }

    const message = await this.prisma.chatMessage.create({
      data: {
        threadId,
        senderId: user.id,
        content: cleanContent,
        isFlagged,
      },
    });

    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: {
        updatedAt: new Date(),
      },
    });

    const receiverCompanyId =
      user.companyId === thread.buyerId ? thread.sellerId : thread.buyerId;

    const receiverUsers = await this.prisma.user.findMany({
      where: {
        companyId: receiverCompanyId,
      },
    });

    await Promise.all(
      receiverUsers.map((receiver) =>
        this.prisma.notification.create({
          data: {
            userId: receiver.id,
            type: 'SYSTEM',
            title: 'Yeni mesajınız var',
            message: cleanContent,
            link: '/chat',
          },
        }),
      ),
    );
    const emailResults = await Promise.allSettled(
      receiverUsers
        .filter((receiver) => receiver.email)
        .map((receiver) =>
          this.mailService.sendNewMessageEmail(receiver.email, cleanContent),
        ),
    );

    emailResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('CHAT EMAIL ERROR:', result.reason);
      }
    });

    this.chatGateway.emitNewMessage(threadId, message);
    return message;
  }
  async sendAdminCompanyMessage(
    user: any,
    companyId: string,
    content: string,
  ) {
    if (user.role !== Role.ADMIN) {
      throw new ForbiddenException('Bu işlemi sadece admin yapabilir');
    }

    if (!content || !content.trim()) {
      throw new BadRequestException('Mesaj boş olamaz');
    }

    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      throw new NotFoundException('Firma bulunamadı');
    }

    const receivers = await this.prisma.user.findMany({
      where: {
        companyId,
      },
    });

    if (!receivers.length) {
      throw new NotFoundException('Firmaya bağlı kullanıcı bulunamadı');
    }

    const cleanContent = content.trim();

    const notifications = await Promise.all(
      receivers.map((receiver) =>
        this.prisma.notification.create({
          data: {
            userId: receiver.id,
            type: 'SYSTEM',
            title: 'Tedarik Pazarı mesajı',
            message: cleanContent,
            link: '/',
          },
        }),
      ),
    );

    notifications.forEach((notification, index) => {
      this.chatGateway.emitNotificationToUser(
        receivers[index].id,
        notification,
      );
    });

    const emailResults = await Promise.allSettled(
      receivers
        .filter((receiver) => receiver.email)
        .map((receiver) =>
          this.mailService.sendNewMessageEmail(
            receiver.email,
            cleanContent,
          ),
        ),
    );

    emailResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('ADMIN COMPANY MESSAGE EMAIL ERROR:', result.reason);
      }
    });

    return {
      success: true,
      message: 'Firma mesajı gönderildi',
      receiverCount: receivers.length,
    };
  }

  async sendFileMessage(
    user: any,
    threadId: string,
    file: Express.Multer.File,
  ) {
    // Authorization must precede every storage operation.
    const thread = await this.canAccessThread(user, threadId);

    if (!file) {
      throw new BadRequestException('Dosya bulunamadı');
    }

    const storage = this.injectedChatFileStorage;

    if (!storage) {
      throw new InternalServerErrorException(
        'Sohbet dosyasi servisi kullanilamiyor',
      );
    }

    // Storage validates content and uses authenticated delivery.
    const stored = await storage.upload(file);

    const message = await (async () => {
      try {
        return await this.prisma.chatMessage.create({
          data: {
            threadId,
            senderId: user.id,
            content: 'Dosya gönderildi',
            fileUrl: `chat-private:${stored.publicId}`,
            fileName: stored.displayName,
            fileType: stored.mimeType,
            fileReview: {
              create: { status: 'PENDING_REVIEW' },
            },
          },
        });
      } catch (error) {
        try {
          await storage.remove(stored);
        } catch {
          throw new InternalServerErrorException(
            'Sohbet dosyasi temizlenemedi; manuel inceleme gerekli',
          );
        }

        throw error;
      }
    })();

    // Pending files must never reach participant notifications,
    // thread sockets, or the thread's visible activity timestamp.
    // The nested review creation is atomic with message creation.
    const safeMessage = toPublicChatMessage(message);

    return {
      id: message.id,
      threadId,
      senderId: message.senderId,
      createdAt: message.createdAt,
      content: 'Dosya incelemede',
      fileUrl: null,
      fileName: safeMessage.fileName,
      fileType: safeMessage.fileType,
      reviewStatus: 'PENDING_REVIEW' as const,
    };
  }

}
