
import { Role } from '@prisma/client';
import { ChatGateway } from './chat.gateway';

describe('ChatGateway leaveThread security', () => {
  let gateway: ChatGateway;
  let emitter: { emit: jest.Mock };
  let server: { to: jest.Mock };
  let prisma: {
    chatThread: { findUnique: jest.Mock };
  };

  beforeEach(() => {
    emitter = { emit: jest.fn() };

    server = {
      to: jest.fn(() => emitter),
    };

    prisma = {
      chatThread: {
        findUnique: jest.fn(async ({ where }) => {
          if (!['room-a', 'room-b'].includes(where.id)) {
            return null;
          }

          return {
            buyerId: 'buyer-co',
            sellerId: 'seller-co',
            logisticsId: null,
          };
        }),
      },
    };

    gateway = new ChatGateway({} as any, prisma as any);
    gateway.server = server as any;
  });

  function makeClient(
    socketId: string,
    companyId = 'buyer-co',
  ) {
    const rooms = new Set<string>([socketId]);

    const client = {
      id: socketId,
      data: {
        chatUser: {
          id: 'buyer',
          companyId,
          role: Role.BUYER,
        },
      },
      rooms,
      join: jest.fn((room: string) => {
        rooms.add(room);
      }),
      leave: jest.fn((room: string) => {
        rooms.delete(room);
      }),
      to: jest.fn(() => emitter),
    };

    gateway.handleConnection(client as any);

    return client;
  }

  it('leaves only the selected room', async () => {
    const client = makeClient('socket-1');

    expect(
      (await gateway.joinThread(
        { threadId: 'room-a' },
        client as any,
      )).ok,
    ).toBe(true);

    expect(
      (await gateway.joinThread(
        { threadId: 'room-b' },
        client as any,
      )).ok,
    ).toBe(true);

    expect(
      await gateway.leaveThread(
        { threadId: 'room-a' },
        client as any,
      ),
    ).toEqual({
      ok: true,
      threadId: 'room-a',
    });

    expect(client.rooms.has('thread:room-a')).toBe(false);
    expect(client.rooms.has('thread:room-b')).toBe(true);
  });

  it('blocks typing events after leaving a room', async () => {
    const client = makeClient('socket-1');

    await gateway.joinThread(
      { threadId: 'room-a' },
      client as any,
    );

    await gateway.leaveThread(
      { threadId: 'room-a' },
      client as any,
    );

    gateway.typingStart(
      { threadId: 'room-a', userId: 'forged' },
      client as any,
    );

    expect(client.to).not.toHaveBeenCalled();
  });

  it('rejects leaving a room never joined', async () => {
    const client = makeClient('socket-1');

    expect(
      await gateway.leaveThread(
        { threadId: 'room-a' },
        client as any,
      ),
    ).toEqual({ ok: false });

    expect(client.leave).not.toHaveBeenCalled();
  });

  it('rejects unauthorized room access', async () => {
    const outsider = makeClient('outsider', 'other-co');

    expect(
      (await gateway.joinThread(
        { threadId: 'room-a' },
        outsider as any,
      )).ok,
    ).toBe(false);

    expect(
      (await gateway.leaveThread(
        { threadId: 'room-a' },
        outsider as any,
      )).ok,
    ).toBe(false);
  });

  it('does not mark a user offline while another tab remains', async () => {
    const first = makeClient('socket-1');
    const second = makeClient('socket-2');

    await gateway.joinThread(
      { threadId: 'room-a' },
      first as any,
    );

    await gateway.joinThread(
      { threadId: 'room-a' },
      second as any,
    );

    emitter.emit.mockClear();

    await gateway.leaveThread(
      { threadId: 'room-a' },
      first as any,
    );

    expect(emitter.emit).not.toHaveBeenCalledWith(
      'userOffline',
      expect.anything(),
    );

    await gateway.leaveThread(
      { threadId: 'room-a' },
      second as any,
    );

    expect(emitter.emit).toHaveBeenCalledTimes(1);
    expect(emitter.emit).toHaveBeenCalledWith(
      'userOffline',
      { userId: 'buyer' },
    );
  });

  it('does not emit offline twice on repeated leave', async () => {
    const client = makeClient('socket-1');

    await gateway.joinThread(
      { threadId: 'room-a' },
      client as any,
    );

    emitter.emit.mockClear();

    const first = await gateway.leaveThread(
      { threadId: 'room-a' },
      client as any,
    );

    const second = await gateway.leaveThread(
      { threadId: 'room-a' },
      client as any,
    );

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);

    expect(emitter.emit).toHaveBeenCalledTimes(1);
  });

  it('does not emit offline for a room already left on disconnect', async () => {
    const client = makeClient('socket-1');

    await gateway.joinThread(
      { threadId: 'room-a' },
      client as any,
    );

    await gateway.leaveThread(
      { threadId: 'room-a' },
      client as any,
    );

    emitter.emit.mockClear();

    gateway.handleDisconnect(client as any);

    expect(emitter.emit).not.toHaveBeenCalledWith(
      'userOffline',
      expect.anything(),
    );
  });
});
