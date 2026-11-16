
import { Role } from '@prisma/client';
import { ChatGateway } from './chat.gateway';

describe('ChatGateway pending join cancellation', () => {
  let gateway: ChatGateway;
  let prisma: { chatThread: { findUnique: jest.Mock } };

  const thread = {
    buyerId: 'buyer-co',
    sellerId: 'seller-co',
    logisticsId: null,
  };

  function client(id = 'socket-1') {
    const rooms = new Set<string>([id]);

    const socket = {
      id,
      data: {
        chatUser: {
          id: 'buyer',
          companyId: 'buyer-co',
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
    };

    gateway.handleConnection(socket as any);
    return socket;
  }

  function deferred() {
    let resolve!: (value: typeof thread) => void;

    const promise = new Promise<typeof thread>(done => {
      resolve = done;
    });

    return { promise, resolve };
  }

  beforeEach(() => {
    prisma = {
      chatThread: {
        findUnique: jest.fn().mockResolvedValue(thread),
      },
    };

    gateway = new ChatGateway({} as any, prisma as any);

    gateway.server = {
      to: jest.fn(() => ({ emit: jest.fn() })),
    } as any;
  });

  it('cancels a pending join when leave arrives first', async () => {
    const waiting = deferred();

    prisma.chatThread.findUnique.mockReturnValue(waiting.promise);

    const socket = client();
    const joining = gateway.joinThread(
      { threadId: 'room-a' },
      socket as any,
    );

    const leaving = await gateway.leaveThread(
      { threadId: 'room-a' },
      socket as any,
    );

    expect(leaving.ok).toBe(false);

    waiting.resolve(thread);

    expect((await joining).ok).toBe(false);
    expect(socket.rooms.has('thread:room-a')).toBe(false);
    expect(socket.join).not.toHaveBeenCalledWith('thread:room-a');
  });

  it('allows the new room but cancels the old delayed room', async () => {
    const waiting = deferred();

    prisma.chatThread.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        where.id === 'room-a'
          ? waiting.promise
          : Promise.resolve(thread),
    );

    const socket = client();

    const oldJoin = gateway.joinThread(
      { threadId: 'room-a' },
      socket as any,
    );

    await gateway.leaveThread(
      { threadId: 'room-a' },
      socket as any,
    );

    const newJoin = await gateway.joinThread(
      { threadId: 'room-b' },
      socket as any,
    );

    waiting.resolve(thread);

    expect(newJoin.ok).toBe(true);
    expect((await oldJoin).ok).toBe(false);
    expect(socket.rooms.has('thread:room-a')).toBe(false);
    expect(socket.rooms.has('thread:room-b')).toBe(true);
  });

  it('prevents a delayed join after disconnect', async () => {
    const waiting = deferred();

    prisma.chatThread.findUnique.mockReturnValue(waiting.promise);

    const socket = client();

    const joining = gateway.joinThread(
      { threadId: 'room-a' },
      socket as any,
    );

    gateway.handleDisconnect(socket as any);

    waiting.resolve(thread);

    expect((await joining).ok).toBe(false);
    expect(socket.rooms.has('thread:room-a')).toBe(false);
  });

  it('allows a fresh join after an earlier join was cancelled', async () => {
    const waiting = deferred();
    let calls = 0;

    prisma.chatThread.findUnique.mockImplementation(() => {
      calls++;
      return calls === 1
        ? waiting.promise
        : Promise.resolve(thread);
    });

    const socket = client();

    const oldJoin = gateway.joinThread(
      { threadId: 'room-a' },
      socket as any,
    );

    await gateway.leaveThread(
      { threadId: 'room-a' },
      socket as any,
    );

    const freshJoin = await gateway.joinThread(
      { threadId: 'room-a' },
      socket as any,
    );

    waiting.resolve(thread);

    expect(freshJoin.ok).toBe(true);
    expect((await oldJoin).ok).toBe(false);
    expect(socket.rooms.has('thread:room-a')).toBe(true);
  });
});
