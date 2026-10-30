import type { ServerToClientEvents } from '@accordo/shared';
import { Inject, Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { fromNodeHeaders } from 'better-auth/node';
import type { Server, Socket } from 'socket.io';
import type { Auth } from '../auth/auth.factory.js';
import { AUTH } from '../auth/auth.tokens.js';

type Events = ServerToClientEvents;

export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Authenticated with the session cookie at handshake; each socket joins `user:{id}` and every
 * event is addressed to the users concerned (ADR-0035).
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() private readonly server!: Server<Record<string, never>, Events>;

  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async handleConnection(socket: Socket) {
    try {
      const session = await this.auth.api.getSession({
        headers: fromNodeHeaders(socket.handshake.headers),
      });
      if (!session || session.user.banned || !session.user.emailVerified) {
        socket.disconnect(true);
        return;
      }
      await socket.join(userRoom(session.user.id));
    } catch (e) {
      this.logger.warn(`Socket auth failed: ${String(e)}`);
      socket.disconnect(true);
    }
  }

  emit<E extends keyof Events>(userIds: string[], event: E, ...args: Parameters<Events[E]>) {
    // The server exists once the HTTP app listens; emitting before that is a no-op.
    this.server?.to(userIds.map(userRoom)).emit(event, ...args);
  }
}
