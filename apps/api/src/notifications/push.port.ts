export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushOptions {
  /** Segundos que el servicio de push guarda el aviso si el dispositivo está apagado. */
  ttl: number;
  urgency: 'high' | 'normal';
  /** Avisos con el mismo tema se reemplazan (por ejemplo, "sonando" → "perdida"). */
  topic?: string;
}

/** `gone` = el navegador canceló la suscripción: hay que borrarla. */
export type PushResult = 'sent' | 'gone' | 'failed';

/**
 * Puerto de envío de notificaciones push. Los servicios dependen de esta abstracción
 * y no de la librería web-push (en los tests se usa una versión falsa).
 */
export abstract class PushSender {
  /** false = no hay claves VAPID: las notificaciones push están deshabilitadas. */
  abstract isAvailable(): boolean;
  abstract readonly publicKey: string | null;
  abstract send(target: PushTarget, payload: string, options: PushOptions): Promise<PushResult>;
}
