import type { Prisma } from '@prisma/client';

export type ChatMessageReviewVisibility = {
  isFlagged?: boolean | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  fileReview?: {
    status?: string | null;
  } | null;
};

/**
 * Participant-facing visibility policy.
 *
 * Ordinary unflagged text remains visible.
 * File messages fail closed until explicitly approved.
 *
 * This policy does not replace thread authorization,
 * storage reference validation or signed-download checks.
 */
export function canParticipantSeeChatMessage(
  message: ChatMessageReviewVisibility,
): boolean {
  if (!message || message.isFlagged === true) {
    return false;
  }

  const hasFileMetadata = [
    message.fileUrl,
    message.fileName,
    message.fileType,
  ].some((value) => value !== null && value !== undefined);

  if (!hasFileMetadata) {
    return true;
  }

  if (
    typeof message.fileUrl !== 'string' ||
    !message.fileUrl.startsWith('chat-private:') ||
    message.fileUrl.length <= 'chat-private:'.length
  ) {
    return false;
  }

  return message.fileReview?.status === 'APPROVED';
}


/**
 * Participant-facing database quarantine.
 *
 * Text without file metadata remains visible.
 * Files require an explicit APPROVED review and
 * a private storage reference.
 * Missing reviews fail closed.
 */
export const participantVisibleChatMessageWhere:
  Prisma.ChatMessageWhereInput = {
    OR: [
      {
        fileUrl: null,
        fileName: null,
        fileType: null,
      },
      {
        fileUrl: {
          startsWith: 'chat-private:',
        },
        fileReview: {
          is: {
            status: 'APPROVED',
          },
        },
      },
    ],
  };
