import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { ServerToClientEvents } from '@qemzagram/shared';
import type { Server, Socket } from 'socket.io';
import { TokensService } from '../auth/tokens.service';
import { UsersRepository } from '../database/repositories/users.repository';
import { RealtimePublisher } from './realtime.port';

const userRoom = (userId: string) => `user:${userId}`;

/** Canal de entrega en tiempo real. El cliente NO envía mensajes por acá: se envían por REST (validado y limitado). */
@WebSocketGateway()
export class RealtimeGateway extends RealtimePublisher implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly tokens: TokensService,
    private readonly users: UsersRepository,
  ) {
    super();
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const auth = client.handshake.auth as { ticket?: unknown };
      if (typeof auth.ticket !== 'string') throw new Error('sin ticket');
      const userId = await this.tokens.verifyWsTicket(auth.ticket);
      const user = await this.users.findById(userId);
      if (!user || user.status !== 'active') throw new Error('usuario inactivo');
      client.data.userId = userId;
      await client.join(userRoom(userId));
    } catch {
      this.logger.debug('Conexión en tiempo real rechazada');
      client.disconnect(true);
    }
  }

  toUsers<E extends keyof ServerToClientEvents>(
    userIds: string[],
    event: E,
    ...payload: Parameters<ServerToClientEvents[E]>
  ): void {
    if (!this.server || userIds.length === 0) return;
    this.server.to(userIds.map(userRoom)).emit(event as string, ...payload);
  }
}
