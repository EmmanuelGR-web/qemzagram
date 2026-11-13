import { Logger } from '@nestjs/common';
import webPush, { WebPushError } from 'web-push';
import { PushSender, type PushOptions, type PushResult, type PushTarget } from './push.port';

/** Tiempo máximo esperando al servicio de push (no bloquear una llamada por un aviso lento). */
const SEND_TIMEOUT_MS = 5_000;

/** Envío real con el protocolo Web Push estándar (VAPID + contenido cifrado aes128gcm). */
export class WebPushSender extends PushSender {
  private readonly logger = new Logger(WebPushSender.name);

  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {
    super();
  }

  isAvailable(): boolean {
    return true;
  }

  async send(target: PushTarget, payload: string, options: PushOptions): Promise<PushResult> {
    try {
      await webPush.sendNotification(target, payload, {
        vapidDetails: { subject: this.subject, publicKey: this.publicKey, privateKey: this.privateKey },
        TTL: options.ttl,
        urgency: options.urgency,
        topic: options.topic,
        timeout: SEND_TIMEOUT_MS,
        contentEncoding: 'aes128gcm',
      });
      return 'sent';
    } catch (error) {
      // 404/410: la suscripción ya no existe (desinstalaron la app, revocaron el permiso…).
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return 'gone';
      // Nunca se registra la dirección de la suscripción (permite mandarle avisos a esa persona).
      this.logger.warn(`No se pudo enviar una notificación push: ${error instanceof WebPushError ? `HTTP ${error.statusCode}` : (error as Error).message}`);
      return 'failed';
    }
  }
}

export class DisabledPushSender extends PushSender {
  readonly publicKey = null;
  isAvailable(): boolean {
    return false;
  }
  async send(): Promise<PushResult> {
    return 'failed';
  }
}
