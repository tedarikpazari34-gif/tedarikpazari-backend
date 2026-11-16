import { Role } from '@prisma/client';
import { ChatService } from './chat.service';
import {
  participantVisibleChatMessageWhere,
} from './chat-file-review-policy';

describe('Chat thread preview quarantine', () => {
  const setup = () => {
    const prisma = {
      chatThread: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = new ChatService(
      prisma as any,
      {} as any,
      {} as any,
    );

    return { prisma, service };
  };

  it.each([
    [Role.ADMIN, null],
    [Role.BUYER, 'buyerId'],
    [Role.SELLER, 'sellerId'],
    [Role.LOGISTICS, 'logisticsId'],
  ])('%s onizlemesinde dosya karantinasini uygular',
    async (role, field) => {
      const { prisma, service } = setup();

      await service.listMine({
        id: 'user-a',
        role,
        companyId: role === Role.ADMIN ? null : 'company-a',
      });

      expect(prisma.chatThread.findMany).toHaveBeenCalledTimes(1);

      const query = prisma.chatThread.findMany.mock.calls[0][0];

      if (role === Role.ADMIN) {
        expect(query.where).toBeUndefined();
      } else {
        expect(query.where).toEqual({
          [field as string]: 'company-a',
        });
      }

      expect(query.include.messages.where).toEqual({
        isFlagged: false,
        ...participantVisibleChatMessageWhere,
      });

      expect(query.include.messages.orderBy).toEqual({
        createdAt: 'desc',
      });

      expect(query.include.messages.take).toBe(1);
    },
  );

  it('admin onizlemesinde ozel firma bilgilerini secmez',
    async () => {
      const { prisma, service } = setup();

      await service.listMine({
        id: 'admin-a',
        role: Role.ADMIN,
      });

      const query = prisma.chatThread.findMany.mock.calls[0][0];

      expect(query.include.buyer).toEqual({
        select: { id: true },
      });

      expect(query.include.seller).toEqual({
        select: { id: true },
      });

      expect(query.include.messages.select).toEqual({
        id: true,
        threadId: true,
        senderId: true,
        content: true,
        createdAt: true,
        isRead: true,
        fileUrl: true,
        fileName: true,
        fileType: true,
      });

      const serialized = JSON.stringify(query.include);

      for (const field of [
        'iyzicoIban',
        'iyzicoIdentityNumber',
        'taxNumber',
        'phone',
        'email',
      ]) {
        expect(serialized).not.toContain(field);
      }
    },
  );
});
