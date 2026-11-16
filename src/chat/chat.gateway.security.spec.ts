import { Role } from '@prisma/client';
import { ChatGateway } from './chat.gateway';

describe('ChatGateway WebSocket authorization', () => {
  let gateway: ChatGateway;
  let jwt: any;
  let prisma: any;
  let server: any;
  let middleware: any;

  const makeClient = (auth: any = {}, query: any = {}) => {
    const rooms = new Set<string>();

    const client: any = {
      id: 'socket-1',
      handshake: { auth, query },
      data: {},
      rooms,
      join: jest.fn((room: string) => {
        rooms.add(room);
      }),
      disconnect: jest.fn(),
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    };

    return client;
  };

  beforeEach(() => {
    jwt = {
      verifyAsync: jest.fn(),
    };

    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      chatThread: {
        findUnique: jest.fn(),
      },
    };

    gateway = new ChatGateway(jwt, prisma);

    server = {
      use: jest.fn((fn: any) => {
        middleware = fn;
      }),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({
        emit: jest.fn(),
      }),
    };

    gateway.server = server;
    gateway.afterInit(server);
  });

  async function authenticate(
    client: any,
    role: Role = Role.BUYER,
    companyId = 'buyer-company',
  ) {
    jwt.verifyAsync.mockResolvedValue({ sub: 'real-user' });

    prisma.user.findUnique.mockResolvedValue({
      id: 'real-user',
      companyId,
      company: { role },
    });

    const next = jest.fn();
    await middleware(client, next);

    expect(next).toHaveBeenCalledWith();
    gateway.handleConnection(client);
  }

  it('rejects a forged query userId without JWT', async () => {
    const client = makeClient({}, { userId: 'victim' });
    const next = jest.fn();

    await middleware(client, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(jwt.verifyAsync).not.toHaveBeenCalled();
    expect(client.data.chatUser).toBeUndefined();
  });

  it('rejects an invalid JWT', async () => {
    const client = makeClient({ token: 'invalid' });
    jwt.verifyAsync.mockRejectedValue(new Error('Invalid signature'));

    const next = jest.fn();
    await middleware(client, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('uses database identity rather than query userId', async () => {
    const client = makeClient(
      { token: 'valid' },
      { userId: 'victim' },
    );

    await authenticate(client);

    expect(client.join).toHaveBeenCalledWith('user:real-user');
    expect(client.join).not.toHaveBeenCalledWith('user:victim');
  });

  it('rejects another company joining a chat room', async () => {
    const client = makeClient({ token: 'valid' });
    await authenticate(client);

    prisma.chatThread.findUnique.mockResolvedValue({
      buyerId: 'other-company',
      sellerId: 'seller-company',
      logisticsId: null,
    });

    const result = await gateway.joinThread(
      { threadId: 'private-thread' },
      client,
    );

    expect(result.ok).toBe(false);
    expect(client.join).not.toHaveBeenCalledWith(
      'thread:private-thread',
    );
  });

  it('allows the actual buyer into its chat', async () => {
    const client = makeClient({ token: 'valid' });
    await authenticate(client);

    prisma.chatThread.findUnique.mockResolvedValue({
      buyerId: 'buyer-company',
      sellerId: 'seller-company',
      logisticsId: null,
    });

    const result = await gateway.joinThread(
      { threadId: 'allowed-thread' },
      client,
    );

    expect(result.ok).toBe(true);
    expect(client.join).toHaveBeenCalledWith(
      'thread:allowed-thread',
    );
  });

  it('allows the admin according to existing REST policy', async () => {
    const client = makeClient({ token: 'valid' });
    await authenticate(client, Role.ADMIN, 'admin-company');

    prisma.chatThread.findUnique.mockResolvedValue({
      buyerId: 'buyer-company',
      sellerId: 'seller-company',
      logisticsId: null,
    });

    const result = await gateway.joinThread(
      { threadId: 'admin-thread' },
      client,
    );

    expect(result.ok).toBe(true);
  });

  it('rejects typing events outside joined rooms', async () => {
    const client = makeClient({ token: 'valid' });
    await authenticate(client);

    gateway.typingStart(
      { threadId: 'foreign-thread', userId: 'victim' },
      client,
    );

    expect(client.to).not.toHaveBeenCalled();
  });

  it('replaces forged typing userId with verified identity', async () => {
    const client = makeClient({ token: 'valid' });
    await authenticate(client);

    client.rooms.add('thread:allowed-thread');

    gateway.typingStart(
      { threadId: 'allowed-thread', userId: 'victim' },
      client,
    );

    expect(client.to).toHaveBeenCalledWith(
      'thread:allowed-thread',
    );

    expect(client.to().emit).toHaveBeenCalledWith(
      'typingStart',
      {
        threadId: 'allowed-thread',
        userId: 'real-user',
      },
    );
  });

  it('does not broadcast presence globally on connection', async () => {
    const client = makeClient({ token: 'valid' });

    await authenticate(client);

    expect(server.emit).not.toHaveBeenCalledWith(
      'userOnline',
      expect.anything(),
    );
  });

  it('sends presence only to an authorized chat room', async () => {
    const client = makeClient({ token: 'valid' });

    await authenticate(client);

    prisma.chatThread.findUnique.mockResolvedValue({
      buyerId: 'buyer-company',
      sellerId: 'seller-company',
      logisticsId: null,
    });

    const result = await gateway.joinThread(
      { threadId: 'allowed-thread' },
      client,
    );

    expect(result.ok).toBe(true);
    expect(server.to).toHaveBeenCalledWith('thread:allowed-thread');
    expect(server.emit).not.toHaveBeenCalledWith(
      'userOnline',
      expect.anything(),
    );
  });

  it('does not broadcast offline globally', async () => {
    const client = makeClient({ token: 'valid' });

    await authenticate(client);

    prisma.chatThread.findUnique.mockResolvedValue({
      buyerId: 'buyer-company',
      sellerId: 'seller-company',
      logisticsId: null,
    });

    await gateway.joinThread(
      { threadId: 'allowed-thread' },
      client,
    );

    gateway.handleDisconnect(client);

    expect(server.emit).not.toHaveBeenCalledWith(
      'userOffline',
      expect.anything(),
    );

    expect(server.to).toHaveBeenCalledWith(
      'thread:allowed-thread',
    );
  });

  it('keeps a user online while another tab remains connected', async () => {
    const first = makeClient({ token: 'valid' });
    const second = makeClient({ token: 'valid' });

    second.id = 'socket-2';

    await authenticate(first);
    await authenticate(second);

    prisma.chatThread.findUnique.mockResolvedValue({
      buyerId: 'buyer-company',
      sellerId: 'seller-company',
      logisticsId: null,
    });

    await gateway.joinThread(
      { threadId: 'allowed-thread' },
      first,
    );

    await gateway.joinThread(
      { threadId: 'allowed-thread' },
      second,
    );

    server.to.mockClear();

    gateway.handleDisconnect(first);

    expect(server.to).not.toHaveBeenCalledWith(
      'thread:allowed-thread',
    );

    gateway.handleDisconnect(second);

    expect(server.to).toHaveBeenCalledWith(
      'thread:allowed-thread',
    );
  });

});
