/** "voice" = nota de voz (AAC en M4A); "video" = video (H.264 + AAC en MP4). */
export type TranscodeTarget = 'voice' | 'video';

export interface TranscodeResult {
  data: Buffer;
  mimeType: string;
  durationMs: number;
  width: number | null;
  height: number | null;
}

/**
 * Puerto de conversión de audio/video. Convertir es la forma confiable de ELIMINAR METADATOS
 * (los videos del celular suelen guardar la ubicación GPS) y de normalizar el formato para que
 * se reproduzca en todos los navegadores.
 */
export abstract class MediaTranscoder {
  /** ¿Está instalado y funcionando? Si no, voz y video quedan deshabilitados (nunca se guardan sin limpiar). */
  abstract isAvailable(): Promise<boolean>;
  abstract transcode(input: Buffer, target: TranscodeTarget, maxSeconds: number): Promise<TranscodeResult>;
}

/** El archivo no se puede aceptar (no tiene audio/video, es demasiado largo, está dañado…). */
export class MediaRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MediaRejectedError';
  }
}
