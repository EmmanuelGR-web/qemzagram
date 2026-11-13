import type { CallKind } from '@qemzagram/shared';

export interface JoinTokenInput {
  /** Sala de medios = id de la llamada (UUID generado por el servidor). */
  room: string;
  /** Identidad dentro de la sala = id del usuario (nunca algo que mande el cliente). */
  identity: string;
  /** Nombre visible para el resto de la llamada. */
  name: string;
  /** Las llamadas de voz no pueden publicar cámara. */
  kind: CallKind;
}

/**
 * Puerto del servidor de medios (SFU). Los servicios dependen de esta abstracción y no de LiveKit:
 * en los tests se usa una versión falsa y, si se cambia de proveedor, se agrega otra implementación.
 *
 * El audio y el video NUNCA pasan por la API: el navegador se conecta al servidor de medios con un
 * token de vida corta y permisos mínimos que emite la API SOLO a miembros de la conversación.
 */
export abstract class CallMediaPort {
  /** false = no hay credenciales configuradas: las llamadas están deshabilitadas. */
  abstract isAvailable(): boolean;
  /** Dirección del servidor de medios que usa el navegador. */
  abstract readonly url: string;
  abstract createJoinToken(input: JoinTokenInput): Promise<string>;
  /** Cierra la sala y desconecta a todos (al terminar la llamada). */
  abstract closeRoom(room: string): Promise<void>;
  /** Saca a una persona de la sala (por ejemplo, si dejó de ser miembro del chat). */
  abstract removeParticipant(room: string, identity: string): Promise<void>;
}
