import { toPublicChatMessage } from './chat-message-public';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

type AuthenticatedChatUser = {
  id: string;
  companyId: string;
  role: Role;
};

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly onlineUsers = new Map<string, string>();
  private readonly socketRooms = new Map<string, Set<string>>();

  private readonly roomIntents = new Map<string, Map<string, number>>();
  private readonly roomMutations = new Map<string, Promise<void>>();
  private readonly disconnectedSockets = new Set<string>();

  private nextRoomIntent(socketId: string, room: string): number {
    const intents = this.roomIntents.get(socketId) ?? new Map<string, number>();
    const version = (intents.get(room) ?? 0) + 1;

    intents.set(room, version);
    this.roomIntents.set(socketId, intents);

    return version;
  }

  private isCurrentRoomIntent(
    socketId: string,
    room: string,
    version: number,
  ): boolean {
    return (
      !this.disconnectedSockets.has(socketId) &&
      this.roomIntents.get(socketId)?.get(room) === version
    );
  }

  private withRoomMutation<T>(
    socketId: string,
    room: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([socketId, room]);
    const previous = this.roomMutations.get(key) ?? Promise.resolve();
    const current = previous.then(action, action);
    const settled = current.then(
      () => undefined,
      () => undefined,
    );

    this.roomMutations.set(key, settled);

    void settled.then(() => {
      if (this.roomMutations.get(key) === settled) {
        this.roomMutations.delete(key);
      }
    });

    return current;
  }


  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    // Socket.IO middleware bağlantı kurulmadan önce çalışır.
    server.use(async (client, next) => {
      try {
        const token = client.handshake.auth?.token;

        if (typeof token !== 'string' || !token.trim()) {
          throw new Error('Missing token');
        }

        const payload = await this.jwtService.verifyAsync<{
          userId?: string;
          sub?: string;
        }>(token);

        const userId = payload?.userId || payload?.sub;

        if (!userId || typeof userId !== 'string') {
          throw new Error('Invalid token payload');
        }

        // Rol ve şirket istemciden değil veritabanından alınır.
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            companyId: true,
            company: {
              select: {
                role: true,
              },
            },
          },
        });

        if (!user?.company || !user.companyId) {
          throw new Error('Unknown user');
        }

        client.data.chatUser = {
          id: user.id,
          companyId: user.companyId,
          role: user.company.role,
        } satisfies AuthenticatedChatUser;

        next();
      } catch {
        // Token ve kullanıcı bilgileri loglara yazılmaz.
        next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(client: Socket) {
    const user = client.data.chatUser as
      | AuthenticatedChatUser
      | undefined;

    if (!user) {
      client.disconnect(true);
      return;
    }

    this.disconnectedSockets.delete(client.id);
    this.onlineUsers.set(client.id, user.id);
    client.join(`user:${user.id}`);

    // Çevrimiçi bilgisi tüm kullanıcılara yayınlanmaz.
  }

  handleDisconnect(client: Socket) {
    const userId = this.onlineUsers.get(client.id);
    const rooms = this.socketRooms.get(client.id) ?? new Set<string>();

    this.onlineUsers.delete(client.id);
    this.socketRooms.delete(client.id);
    this.disconnectedSockets.add(client.id);
    this.roomIntents.delete(client.id);

    if (!userId) return;

    for (const room of rooms) {
      const anotherSocketOnline = [...this.socketRooms].some(
        ([socketId, joinedRooms]) =>
          joinedRooms.has(room) &&
          this.onlineUsers.get(socketId) === userId,
      );

      if (!anotherSocketOnline) {
        this.server?.to(room).emit('userOffline', { userId });
      }
    }
  }


  @SubscribeMessage('joinThread')
  async joinThread(
    @MessageBody() data: { threadId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data.chatUser as
      | AuthenticatedChatUser
      | undefined;

    const threadId = data?.threadId;

    if (
      !user ||
      typeof threadId !== 'string' ||
      !threadId.trim() ||
      threadId.length > 128
    ) {
      return { ok: false };
    }

    const room = `thread:${threadId}`;

    // Katılma isteğinin sürümünü DB sorgusundan ÖNCE kaydet.
    const version = this.nextRoomIntent(client.id, room);

    const thread = await this.prisma.chatThread.findUnique({
      where: { id: threadId },
      select: {
        buyerId: true,
        sellerId: true,
        logisticsId: true,
      },
    });

    // DB sorgusu sırasında leaveThread veya disconnect geldiyse
    // eski katılma isteği artık geçersizdir.
    if (!this.isCurrentRoomIntent(client.id, room, version)) {
      return { ok: false };
    }

    if (!thread) {
      return { ok: false };
    }

    const allowed =
      user.role === Role.ADMIN ||
      (user.role === Role.BUYER &&
        thread.buyerId === user.companyId) ||
      (user.role === Role.SELLER &&
        thread.sellerId === user.companyId) ||
      (user.role === Role.LOGISTICS &&
        thread.logisticsId === user.companyId);

    if (!allowed) {
      return { ok: false };
    }

    return this.withRoomMutation(client.id, room, async () => {
      if (!this.isCurrentRoomIntent(client.id, room, version)) {
        return { ok: false };
      }

      const joinedRooms =
        this.socketRooms.get(client.id) ?? new Set<string>();

      if (!joinedRooms.has(room)) {
        const peers = new Set<string>();

        for (const [socketId, rooms] of this.socketRooms) {
          if (!rooms.has(room)) continue;

          const peerId = this.onlineUsers.get(socketId);

          if (peerId && peerId !== user.id) {
            peers.add(peerId);
          }
        }

        await client.join(room);

        // Odaya katılma işlemi beklerken de iptal gelmiş olabilir.
        if (!this.isCurrentRoomIntent(client.id, room, version)) {
          await client.leave(room);
          return { ok: false };
        }

        joinedRooms.add(room);
        this.socketRooms.set(client.id, joinedRooms);

        for (const peerId of peers) {
          this.server?.to(client.id).emit('userOnline', {
            userId: peerId,
          });
        }

        this.server?.to(room).emit('userOnline', {
          userId: user.id,
        });
      }

      return { ok: true, threadId };
    });
  }

  @SubscribeMessage('leaveThread')
  async leaveThread(
    @MessageBody() data: { threadId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    const user = client.data.chatUser as
      | AuthenticatedChatUser
      | undefined;

    const threadId = data?.threadId;

    if (
      !user ||
      typeof threadId !== 'string' ||
      !threadId.trim() ||
      threadId.length > 128
    ) {
      return { ok: false };
    }

    const room = `thread:${threadId}`;

    // Henüz odaya girilmemiş olsa bile bekleyen join iptal edilir.
    this.nextRoomIntent(client.id, room);

    return this.withRoomMutation(client.id, room, async () => {
      const rooms = this.socketRooms.get(client.id);

      if (!rooms?.has(room) || !client.rooms.has(room)) {
        return { ok: false };
      }

      await client.leave(room);

      if (this.disconnectedSockets.has(client.id)) {
        return { ok: false };
      }

      rooms.delete(room);

      if (rooms.size === 0) {
        this.socketRooms.delete(client.id);
      }

      const stillOnline = [...this.socketRooms].some(
        ([socketId, joinedRooms]) =>
          joinedRooms.has(room) &&
          this.onlineUsers.get(socketId) === user.id,
      );

      if (!stillOnline) {
        this.server?.to(room).emit('userOffline', {
          userId: user.id,
        });
      }

      return { ok: true, threadId };
    });
  }

  private emitTyping(
    event: 'typingStart' | 'typingStop',
    data: { threadId?: string },
    client: Socket,
  ) {
    const user = client.data.chatUser as
      | AuthenticatedChatUser
      | undefined;

    const threadId = data?.threadId;

    if (
      !user ||
      typeof threadId !== 'string' ||
      !client.rooms.has(`thread:${threadId}`)
    ) {
      return;
    }

    client.to(`thread:${threadId}`).emit(event, {
      threadId,
      userId: user.id,
    });
  }

  @SubscribeMessage('typingStart')
  typingStart(
    @MessageBody() data: { threadId?: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.emitTyping('typingStart', data, client);
  }

  @SubscribeMessage('typingStop')
  typingStop(
    @MessageBody() data: { threadId?: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.emitTyping('typingStop', data, client);
  }

  getOnlineUserCount() {
    return new Set(this.onlineUsers.values()).size;
  }

  isReady() {
    return Boolean(this.server);
  }

  emitNotificationToUser(userId: string, notification: any) {
    if (!this.server || !userId) return;

    this.server.to(`user:${userId}`).emit(
      'newNotification',
      notification,
    );
  }

  emitChatFileReviewChanged(
    threadId: string | null,
    senderId: string | null,
    decision: string,
  ) {
    if (!this.server) return;

    if (
      typeof threadId !== 'string' ||
      typeof senderId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(threadId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(senderId)
    ) {
      return;
    }

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      return;
    }

    // Only a refresh signal. No file metadata or review notes.
    const event = { threadId };

    if (decision === 'APPROVED') {
      // Thread membership is checked by joinThread.
      this.server
        .to(`thread:${threadId}`)
        .emit('chatFileReviewChanged', event);
    } else {
      // Rejected files must never be announced to the thread.
      this.server
        .to(`user:${senderId}`)
        .emit('chatFileReviewChanged', event);
    }
  }

  emitNewMessage(threadId: string, message: any) {
    if (!this.server || !threadId) return;

    this.server.to(`thread:${threadId}`).emit(
      'newMessage',
      toPublicChatMessage(message),
    );
  }
}
