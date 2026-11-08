
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Role } from '@prisma/client';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

describe('Chat moderation contract', () => {
  const admin = {
    id: 'admin-2521',
    role: Role.ADMIN,
    companyId: 'company-2521',
  };

  let service: ChatService;
  let controller: ChatController;
  let tx: any;
  let prisma: any;
  let message: any;

  beforeEach(() => {
    message = {
      id: 'message-2521',
      content: 'original-test-content',
      isFlagged: true,
      reviewedAt: null,
      reviewedById: null,
      reviewDecision: null,
    };

    tx = {
      chatMessage: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (
            message.id !== where.id ||
            !message.isFlagged ||
            message.reviewedAt !== null
          ) {
            return { count: 0 };
          }

          Object.assign(message, data);
          return { count: 1 };
        }),
      },
      auditLog: {
        create: jest.fn(async () => ({ id: 'audit-2521' })),
      },
    };

    prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      chatMessage: {
        findMany: jest.fn(async () => [message]),
      },
    };

    service = new ChatService(
      prisma as any,
      {} as any,
      {} as any,
    );

    controller = new ChatController(service);
  });

  it('route is POST and protected by JWT', () => {
    const handler = ChatController.prototype.reviewFlagged;

    expect(Reflect.getMetadata(PATH_METADATA, handler))
      .toBe('admin/flagged/:messageId/review');

    expect(Reflect.getMetadata(METHOD_METADATA, handler))
      .toBe(RequestMethod.POST);

    expect(Reflect.getMetadata(GUARDS_METADATA, handler))
      .toContain(JwtAuthGuard);
  });

  it('controller records decision and preserves message', async () => {
    const result = await controller.reviewFlagged(
      { user: admin },
      message.id,
      {
        decision: 'NO_VIOLATION',
        note: 'test-review',
      },
    );

    expect(result.reviewDecision).toBe('NO_VIOLATION');
    expect(message.content).toBe('original-test-content');
    expect(message.isFlagged).toBe(true);
    expect(message.reviewedAt).toBeInstanceOf(Date);
    expect(message.reviewedById).toBe(admin.id);
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('non-admin review is rejected', async () => {
    await expect(
      controller.reviewFlagged(
        { user: { id: 'buyer-2521', role: Role.BUYER } },
        message.id,
        { decision: 'NO_VIOLATION' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.chatMessage.updateMany).not.toHaveBeenCalled();
  });

  it('concurrent review attempts allow only one decision', async () => {
    const results = await Promise.allSettled([
      controller.reviewFlagged(
        { user: admin },
        message.id,
        { decision: 'NO_VIOLATION' },
      ),
      controller.reviewFlagged(
        { user: admin },
        message.id,
        { decision: 'VIOLATION_CONFIRMED' },
      ),
    ]);

    expect(results.filter((x) => x.status === 'fulfilled'))
      .toHaveLength(1);

    expect(results.filter((x) => x.status === 'rejected'))
      .toHaveLength(1);

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('reviewed flagged message remains in admin history', async () => {
    await controller.reviewFlagged(
      { user: admin },
      message.id,
      { decision: 'NO_VIOLATION' },
    );

    const result = await service.listFlaggedMessages(admin);

    expect(result).toHaveLength(1);
    expect(result[0].reviewedAt).toBeTruthy();
    expect(prisma.chatMessage.findMany)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isFlagged: true },
        }),
      );
  });
});
