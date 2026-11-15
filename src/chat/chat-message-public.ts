type ChatMessageShape = {
  id?: string;
  threadId?: string;
  content?: string;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
};

const SAFE_NAMES: Record<string, string> = {
  'application/pdf': 'Belge.pdf',
  'image/jpeg': 'Gorsel.jpg',
  'image/png': 'Gorsel.png',
  'image/webp': 'Gorsel.webp',
};

export function toPublicChatMessage<T extends ChatMessageShape>(
  message: T,
): T {
  if (
    !message ||
    typeof message !== 'object' ||
    !(
      (typeof message.fileUrl === 'string' &&
        message.fileUrl.length > 0) ||
      (typeof message.fileName === 'string' &&
        message.fileName.length > 0)
    )
  ) {
    return message;
  }

  const fileUrl =
    typeof message.fileUrl === 'string' &&
    message.fileUrl.length > 0 &&
    typeof message.threadId === 'string' &&
    typeof message.id === 'string'
      ? '/api/chat/threads/' +
        encodeURIComponent(message.threadId) +
        '/files/' +
        encodeURIComponent(message.id)
      : null;

  return {
    ...message,
    content: 'Dosya gönderildi',
    fileName:
      SAFE_NAMES[message.fileType || ''] || 'Dosya',
    fileUrl,
  } as T;
}


export function toPublicChatThread<
  T extends {
    messages?: readonly ChatMessageShape[] | null;
  },
>(thread: T): T {
  if (
    !thread ||
    typeof thread !== 'object' ||
    !Array.isArray(thread.messages)
  ) {
    return thread;
  }

  return {
    ...thread,
    messages: thread.messages.map(toPublicChatMessage),
  } as T;
}
