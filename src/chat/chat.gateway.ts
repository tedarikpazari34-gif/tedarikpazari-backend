import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: true,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private onlineUsers = new Map<string, string>();

  handleConnection(client: Socket) {
    const userId = client.handshake.query.userId as string;

    if (userId) {
      this.onlineUsers.set(client.id, userId);
      client.join(`user:${userId}`);

      this.server.emit('userOnline', {
        userId,
      });
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.onlineUsers.get(client.id);

    if (userId) {
      this.onlineUsers.delete(client.id);

      this.server.emit('userOffline', {
        userId,
      });
    }
  }

  @SubscribeMessage('joinThread')
  joinThread(
    @MessageBody() data: { threadId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.threadId) return;

    client.join(`thread:${data.threadId}`);

    return {
      ok: true,
      threadId: data.threadId,
    };
  }

  @SubscribeMessage('typingStart')
  typingStart(
    @MessageBody() data: { threadId: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.threadId) return;

    client.to(`thread:${data.threadId}`).emit('typingStart', {
      threadId: data.threadId,
      userId: data.userId,
    });
  }

  @SubscribeMessage('typingStop')
  typingStop(
    @MessageBody() data: { threadId: string; userId?: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (!data?.threadId) return;

    client.to(`thread:${data.threadId}`).emit('typingStop', {
      threadId: data.threadId,
      userId: data.userId,
    });
  }

  getOnlineUserCount() {
    return new Set(this.onlineUsers.values()).size;
  }

  isReady() {
    return Boolean(this.server);
  }

  emitNotificationToUser(userId: string, notification: any) {
    if (!this.server || !userId) return;

    this.server.to(`user:${userId}`).emit('newNotification', notification);
  }

  emitNewMessage(threadId: string, message: any) {
    this.server.to(`thread:${threadId}`).emit('newMessage', message);
  }
}
