import { readFileSync } from 'fs';
import { join } from 'path';
import {
  participantVisibleChatMessageWhere,
} from './chat-file-review-policy';

describe('Chat quarantine database query contract', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/chat/chat.service.ts'),
    'utf8',
  );

  const method = (start: string, end: string) => {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);

    if (first < 0 || last < 0) {
      throw new Error('Chat service method boundary missing');
    }

    return source.slice(first, last);
  };

  it('normal metin mesajlarini korur', () => {
    expect(participantVisibleChatMessageWhere).toEqual({
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
            is: { status: 'APPROVED' },
          },
        },
      ],
    });
  });

  it('yalniz onayli ozel dosyalara sorgu izni verir', () => {
    const query = JSON.stringify(
      participantVisibleChatMessageWhere,
    );

    expect(query).toContain('"APPROVED"');
    expect(query).toContain('"chat-private:"');
    expect(query).not.toContain('"PENDING_REVIEW"');
    expect(query).not.toContain('"REJECTED"');
  });

  it('mesaj listesinde karantina filtresi kullanilir', () => {
    const body = method(
      '  async getMessages(',
      '  async listFlaggedMessages(',
    );

    const find = body.slice(
      body.indexOf('const messages ='),
    );

    expect(find).toContain(
      '...participantVisibleChatMessageWhere',
    );
    expect(find).toContain(
      'this.prisma.chatMessage.findMany',
    );
  });

  it('bekleyen dosyalar okunmus olarak isaretlenmez', () => {
    const body = method(
      '  async getMessages(',
      '  async listFlaggedMessages(',
    );

    const update = body.slice(
      body.indexOf('this.prisma.chatMessage.updateMany'),
      body.indexOf('const messages ='),
    );

    expect(update).toContain(
      '...participantVisibleChatMessageWhere',
    );
    expect(update).toContain('isFlagged: false');
  });

  it('okunmamis mesaj sayisi karantinayi uygular', () => {
    const body = method(
      '  async getUnreadCount(',
      '  async sendMessage(',
    );

    expect(body).toContain(
      '...participantVisibleChatMessageWhere',
    );
    expect(body).toContain('isFlagged: false');
  });
});
