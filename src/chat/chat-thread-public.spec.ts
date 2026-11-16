import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatGateway } from './chat.gateway';
import { MailService } from '../mail/mail.service';
import { ChatService } from './chat.service';
import {
  toPublicChatMessage,
  toPublicChatThread,
} from './chat-message-public';

describe('Chat thread preview privacy', () => {
  const threadsFindMany = jest.fn();
  const flaggedFindMany = jest.fn();

  const fileMessage = {
    id: 'message-a',
    threadId: 'thread-a',
    senderId: 'seller-user',
    content: '0532-ozel-belge.pdf',
    fileName: '0532-ozel-belge.pdf',
    fileUrl:
      'chat-private:tedarik-pazari-platform/chat/private123.pdf',
    fileType: 'application/pdf',
    isFlagged: false,
  };

  const service = new ChatService(
    {
      chatThread: {
        findMany: threadsFindMany,
      },
      chatMessage: {
        findMany: flaggedFindMany,
      },
    } as unknown as PrismaService,
    {} as ChatGateway,
    {} as MailService,
  );

  beforeEach(() => {
    threadsFindMany.mockReset();
    flaggedFindMany.mockReset();

    threadsFindMany.mockResolvedValue([
      {
        id: 'thread-a',
        messages: [{ ...fileMessage }],
      },
    ]);
  });

  it.each([
    Role.ADMIN,
    Role.BUYER,
    Role.SELLER,
    Role.LOGISTICS,
  ])('%s sohbet listesinde ozel bilgileri gizler', async (role) => {
    const result = await service.listMine({
      id: 'user-a',
      role,
      companyId: 'buyer-company',
    });

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('private123');
    expect(serialized).not.toContain('0532');

    expect(result[0].messages[0].fileName)
      .toBe('Belge.pdf');

    expect(result[0].messages[0].fileUrl)
      .toBe(
        '/api/chat/threads/thread-a/files/message-a',
      );
  });

  it('admin inceleme yanitinda dosya referansini gizler', async () => {
    flaggedFindMany.mockResolvedValue([
      {
        ...fileMessage,
        isFlagged: true,
      },
    ]);

    const result = await service.listFlaggedMessages({
      role: Role.ADMIN,
    });

    expect(JSON.stringify(result))
      .not.toContain('private123');

    expect(JSON.stringify(result))
      .not.toContain('0532');
  });

  it('yalniz dosya adi varsa da ozel adi gizler', () => {
    const result = toPublicChatMessage({
      ...fileMessage,
      fileUrl: null,
    });

    expect(result.fileName).toBe('Belge.pdf');
    expect(result.content).toBe('Dosya gönderildi');
    expect(result.fileUrl).toBeNull();

    expect(JSON.stringify(result))
      .not.toContain('0532');
  });

  it('normal metin onizlemesini degistirmez', () => {
    const message = {
      id: 'text-a',
      threadId: 'thread-a',
      content: 'Merhaba',
      fileUrl: null,
      fileName: null,
    };

    const thread = {
      id: 'thread-a',
      messages: [message],
    };

    const result = toPublicChatThread(thread);

    expect(result.messages[0]).toEqual(message);
    expect(result.messages[0].content).toBe('Merhaba');
  });
});
