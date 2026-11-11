import type { ServerToClientEvents } from '@qemzagram/shared';

/**
 * Puerto de entrega en tiempo real. Los servicios de negocio dependen de esta abstracción
 * y no de Socket.IO (principio de inversión de dependencias).
 */
export abstract class RealtimePublisher {
  abstract toUsers<E extends keyof ServerToClientEvents>(
    userIds: string[],
    event: E,
    ...payload: Parameters<ServerToClientEvents[E]>
  ): void;
}
