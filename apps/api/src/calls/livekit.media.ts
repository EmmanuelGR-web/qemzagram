import { Logger } from '@nestjs/common';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { CallMediaPort, type JoinTokenInput } from './call-media.port';

/**
 * Vida del token para ENTRAR a la sala. Una vez conectado, LiveKit renueva la sesión solo,
 * así que una llamada larga no se corta; un token filtrado deja de servir enseguida.
 */
const JOIN_TOKEN_TTL = '2m';

/** Implementación con LiveKit (servidor de medios SFU con TURN incluido). */
export class LiveKitCallMedia extends CallMediaPort {
  private readonly logger = new Logger(LiveKitCallMedia.name);
  private readonly rooms: RoomServiceClient;

  constructor(
    readonly url: string,
    apiUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {
    super();
    this.rooms = new RoomServiceClient(apiUrl, apiKey, apiSecret);
  }

  isAvailable(): boolean {
    return true;
  }

  async createJoinToken(input: JoinTokenInput): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, { identity: input.identity, name: input.name, ttl: JOIN_TOKEN_TTL });
    // Permisos mínimos: entrar a ESA sala, escuchar/ver y publicar solo micrófono (y cámara si es videollamada).
    // Sin datos, sin metadatos propios, sin compartir pantalla, sin crear ni administrar salas.
    token.addGrant({
      roomJoin: true,
      room: input.room,
      canSubscribe: true,
      canPublish: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      canPublishSources: input.kind === 'video' ? [TrackSource.MICROPHONE, TrackSource.CAMERA] : [TrackSource.MICROPHONE],
    });
    return token.toJwt();
  }

  async closeRoom(room: string): Promise<void> {
    try {
      await this.rooms.deleteRoom(room);
    } catch (error) {
      // Si la sala ya no existe (nadie se llegó a conectar) no es un error.
      this.logger.debug(`No se pudo cerrar la sala: ${(error as Error).message}`);
    }
  }

  async removeParticipant(room: string, identity: string): Promise<void> {
    try {
      await this.rooms.removeParticipant(room, identity);
    } catch (error) {
      this.logger.debug(`No se pudo sacar a un participante: ${(error as Error).message}`);
    }
  }
}

/** Sin credenciales: las llamadas quedan deshabilitadas (la API responde 503). */
export class DisabledCallMedia extends CallMediaPort {
  readonly url = '';
  isAvailable(): boolean {
    return false;
  }
  createJoinToken(): Promise<string> {
    return Promise.reject(new Error('Llamadas deshabilitadas'));
  }
  async closeRoom(): Promise<void> {}
  async removeParticipant(): Promise<void> {}
}
