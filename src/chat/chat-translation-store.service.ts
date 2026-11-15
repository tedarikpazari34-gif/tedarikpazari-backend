import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatLanguage } from './chat-translation.policy';

export const CHAT_FREE_MONTHLY_LIMIT = 400_000;

type TranslationMessage = {
  id: string;
  content: string;
  isFlagged?: boolean;
  fileUrl?: string | null;
  fileName?: string | null;
};

type ClaimStatus =
  | 'RESERVED'
  | 'CACHED'
  | 'PENDING'
  | 'FAILED'
  | 'LIMIT_REACHED'
  | 'SKIPPED';

type ClaimResult = {
  status: ClaimStatus;
  translatedContent: string | null;
};

@Injectable()
export class ChatTranslationStoreService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async getOrReserve(
    message: TranslationMessage,
    targetLanguage: ChatLanguage,
  ): Promise<ClaimResult> {
    const result = (
      status: ClaimStatus,
      translatedContent: string | null = null,
    ): ClaimResult => ({ status, translatedContent });

    if (
      !message.content?.trim() ||
      message.isFlagged ||
      message.fileUrl ||
      message.fileName ||
      [...message.content].length > 5000
    ) {
      return result('SKIPPED');
    }

    const sourceHash = this.hash(message.content);
    const key = {
      messageId: message.id,
      targetLanguage,
      sourceHash,
    };

    const month = new Date().toISOString().slice(0, 7);
    const characters = [...message.content].length;
    const pendingDeadline = new Date(Date.now() - 10 * 60 * 1000);

    const readExisting = async () => {
      const existing = await this.prisma.chatMessageTranslation.findUnique({
        where: { messageId_targetLanguage_sourceHash: key },
      });

      if (!existing) return result('FAILED');

      if (
        existing.status === 'PENDING' &&
        existing.updatedAt.getTime() < pendingDeadline.getTime()
      ) {
        await this.prisma.chatMessageTranslation.updateMany({
          where: {
            ...key,
            status: 'PENDING',
            updatedAt: { lt: pendingDeadline },
          },
          data: { status: 'FAILED' },
        });
        return result('FAILED');
      }

      if (
        existing.status === 'TRANSLATED' &&
        existing.translatedContent
      ) {
        return result('CACHED', existing.translatedContent);
      }

      return result(existing.status === 'FAILED' ? 'FAILED' : 'PENDING');
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.chatTranslationQuota.upsert({
          where: { month },
          create: { month, usedCharacters: 0 },
          update: {},
        });

        const existing = await tx.chatMessageTranslation.findUnique({
          where: { messageId_targetLanguage_sourceHash: key },
        });

        if (existing) {
          if (
            existing.status === 'PENDING' &&
            existing.updatedAt.getTime() < pendingDeadline.getTime()
          ) {
            await tx.chatMessageTranslation.updateMany({
              where: {
                ...key,
                status: 'PENDING',
                updatedAt: { lt: pendingDeadline },
              },
              data: { status: 'FAILED' },
            });
            return result('FAILED');
          }

          if (
            existing.status === 'TRANSLATED' &&
            existing.translatedContent
          ) {
            return result('CACHED', existing.translatedContent);
          }

          return result(
            existing.status === 'FAILED' ? 'FAILED' : 'PENDING',
          );
        }

        const reserved = await tx.chatTranslationQuota.updateMany({
          where: {
            month,
            usedCharacters: {
              lte: CHAT_FREE_MONTHLY_LIMIT - characters,
            },
          },
          data: {
            usedCharacters: { increment: characters },
          },
        });

        if (reserved.count !== 1) {
          return result('LIMIT_REACHED');
        }

        await tx.chatMessageTranslation.create({
          data: {
            messageId: message.id,
            targetLanguage,
            sourceHash,
            status: 'PENDING',
          },
        });

        return result('RESERVED');
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        return readExisting();
      }
      throw error;
    }
  }

  async complete(
    message: TranslationMessage,
    targetLanguage: ChatLanguage,
    translatedContent: string,
  ): Promise<boolean> {
    if (!translatedContent.trim()) return false;

    const updated = await this.prisma.chatMessageTranslation.updateMany({
      where: {
        messageId: message.id,
        targetLanguage,
        sourceHash: this.hash(message.content),
        status: 'PENDING',
      },
      data: {
        status: 'TRANSLATED',
        translatedContent,
      },
    });

    return updated.count === 1;
  }

  async fail(
    message: TranslationMessage,
    targetLanguage: ChatLanguage,
  ): Promise<void> {
    // Harcanmış olabilecek karakter kotası geri verilmez.
    await this.prisma.chatMessageTranslation.updateMany({
      where: {
        messageId: message.id,
        targetLanguage,
        sourceHash: this.hash(message.content),
        status: 'PENDING',
      },
      data: { status: 'FAILED' },
    });
  }
}
