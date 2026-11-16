import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { toPublicChatMessage } from './chat-message-public';

describe('Chat file public response privacy', () => {
  const fileMessage = {
    id: 'message-a',
    threadId: 'thread-a',
    senderId: 'seller-user',
    content: 'ozel-ad-telefon.pdf',
    fileName: 'ozel-ad-telefon.pdf',
    fileUrl:
      'chat-private:tedarik-pazari-platform/chat/private123.pdf',
    fileType: 'application/pdf',
    isFlagged: false,
  };

  it('Cloudinary kimligini ve orijinal adi gizler', () => {
    const result = toPublicChatMessage(fileMessage);

    expect(result.fileUrl).toBe(
      '/api/chat/threads/thread-a/files/message-a',
    );

    expect(result.fileName).toBe('Belge.pdf');
    expect(result.content).toBe('Dosya gönderildi');

    expect(JSON.stringify(result)).not.toContain(
      'private123',
    );

    expect(JSON.stringify(result)).not.toContain(
      'ozel-ad-telefon',
    );
  });

  it('orijinal veritabani kaydini degistirmez', () => {
    toPublicChatMessage(fileMessage);

    expect(fileMessage.fileUrl).toContain(
      'chat-private:',
    );

    expect(fileMessage.fileName).toBe(
      'ozel-ad-telefon.pdf',
    );
  });

  it('eski herkese acik dosya yolunu gizler', () => {
    const result = toPublicChatMessage({
      ...fileMessage,
      fileUrl: '/uploads/chat/private-name.pdf',
    });

    expect(JSON.stringify(result)).not.toContain(
      '/uploads/chat/',
    );

    expect(result.fileName).toBe('Belge.pdf');
  });

  it('normal metin mesajini degistirmez', () => {
    const text = {
      id: 'text-a',
      threadId: 'thread-a',
      content: 'Merhaba',
      fileUrl: null,
    };

    expect(toPublicChatMessage(text)).toBe(text);
  });

  it('dosya turune gore genel ad verir', () => {
    expect(
      toPublicChatMessage({
        ...fileMessage,
        fileType: 'image/png',
      }).fileName,
    ).toBe('Gorsel.png');

    expect(
      toPublicChatMessage({
        ...fileMessage,
        fileType: 'application/unknown',
      }).fileName,
    ).toBe('Dosya');
  });

  it('sohbet ve mesaj kimliklerini URL icin kodlar', () => {
    const result = toPublicChatMessage({
      ...fileMessage,
      threadId: 'thread/a',
      id: 'message/b',
    });

    expect(result.fileUrl).toBe(
      '/api/chat/threads/thread%2Fa/files/message%2Fb',
    );
  });

  it('REST mesaj yanitinda ozel kimligi gizler', async () => {
    const service = Object.create(
      ChatService.prototype,
    ) as ChatService;

    const findMany = jest.fn().mockResolvedValue([
      { ...fileMessage },
    ]);

    Object.assign(service, {
      prisma: {
        chatMessage: {
          updateMany: jest.fn().mockResolvedValue({
            count: 0,
          }),
          findMany,
        },
      },
      canAccessThread: jest.fn().mockResolvedValue({
        id: 'thread-a',
      }),
    });

    const result = await service.getMessages(
      { id: 'buyer-user' },
      'thread-a',
    );

    expect(result).toHaveLength(1);

    expect(JSON.stringify(result)).not.toContain(
      'private123',
    );

    expect(JSON.stringify(result)).not.toContain(
      'ozel-ad-telefon',
    );
  });

  it('dosya mesajini ceviriye gondermez', async () => {
    const service = Object.create(
      ChatService.prototype,
    ) as ChatService;

    const translateMessage = jest.fn();

    Object.assign(service, {
      prisma: {
        chatMessage: {
          updateMany: jest.fn().mockResolvedValue({
            count: 0,
          }),
          findMany: jest.fn().mockResolvedValue([
            { ...fileMessage },
          ]),
        },
      },
      canAccessThread: jest.fn().mockResolvedValue({
        id: 'thread-a',
      }),
      injectedChatTranslation: {
        translateMessage,
      },
    });

    const result = await service.getMessages(
      { id: 'buyer-user' },
      'thread-a',
      'en',
    );

    expect(
      (result[0] as unknown as {
        translationStatus?: string;
      }).translationStatus,
    ).toBe(
      'SKIPPED',
    );

    expect(translateMessage).not.toHaveBeenCalled();
  });

  it('WebSocket mesajinda dosya kimligini gizler', () => {
    const gateway = Object.create(
      ChatGateway.prototype,
    ) as ChatGateway;

    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });

    Object.assign(gateway, {
      server: { to },
    });

    gateway.emitNewMessage(
      'thread-a',
      { ...fileMessage },
    );

    expect(to).toHaveBeenCalledWith(
      'thread:thread-a',
    );

    expect(emit).toHaveBeenCalledWith(
      'newMessage',
      expect.objectContaining({
        fileName: 'Belge.pdf',
        fileUrl:
          '/api/chat/threads/thread-a/files/message-a',
      }),
    );

    expect(JSON.stringify(emit.mock.calls)).not.toContain(
      'private123',
    );
  });
});
