import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PushConfigDto, PushPayload, PushSubscriptionInput } from '@qemzagram/shared';
import { CryptoService } from '../common/crypto.service';
import { PushSubscriptionsRepository } from '../database/repositories/push-subscriptions.repository';
import { PushSender, type PushOptions, type PushTarget } from './push.port';

/** Dispositivos con notificaciones por persona (los más viejos se descartan). */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Servicios de push oficiales de los navegadores. El servidor hace pedidos HTTP a la dirección
 * de la suscripción: aceptar cualquier dirección permitiría usar la API para llegar a la red interna
 * (SSRF). Por eso solo se aceptan estos dominios, con https y sin puerto explícito.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.port === '' && !url.username && !url.password && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

const subscriptionAad = (endpointHash: string) => `push:${endpointHash}`;

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly subscriptions: PushSubscriptionsRepository,
    private readonly sender: PushSender,
    private readonly crypto: CryptoService,
  ) {}

  config(): PushConfigDto {
    return { publicKey: this.sender.isAvailable() ? this.sender.publicKey : null };
  }

  async subscribe(userId: string, input: PushSubscriptionInput): Promise<void> {
    if (!this.sender.isAvailable()) throw new ServiceUnavailableException({ code: 'PUSH_UNAVAILABLE', message: 'Las notificaciones no están disponibles' });
    if (!isAllowedPushEndpoint(input.endpoint)) throw new BadRequestException({ code: 'INVALID_PUSH_ENDPOINT', message: 'Servicio de notificaciones no reconocido' });
    const endpointHash = this.crypto.sha256(input.endpoint);
    const target: PushTarget = { endpoint: input.endpoint, keys: input.keys };
    // Se guarda CIFRADO: la dirección y las claves permiten mandarle avisos a esa persona.
    await this.subscriptions.upsert(userId, endpointHash, this.crypto.encryptText(JSON.stringify(target), subscriptionAad(endpointHash)));
    await this.subscriptions.trimForUser(userId, MAX_SUBSCRIPTIONS_PER_USER);
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.deleteOwned(userId, this.crypto.sha256(endpoint));
  }

  async removeAllFor(userId: string): Promise<void> {
    await this.subscriptions.deleteAllForUser(userId);
  }

  /**
   * Manda un aviso a todos los dispositivos de esas personas. Nunca falla hacia afuera:
   * una notificación que no llega no debe romper la llamada. Borra las suscripciones vencidas.
   */
  async notify(userIds: string[], payload: PushPayload, options: PushOptions): Promise<void> {
    if (!this.sender.isAvailable() || userIds.length === 0) return;
    try {
      const rows = await this.subscriptions.listForUsers(userIds);
      const body = JSON.stringify(payload);
      await Promise.all(
        rows.map(async (row) => {
          let target: PushTarget;
          try {
            target = JSON.parse(this.crypto.decryptText(row.dataEncrypted, subscriptionAad(row.endpointHash))) as PushTarget;
          } catch {
            await this.subscriptions.deleteById(row.id); // dato corrupto o clave rotada
            return;
          }
          if ((await this.sender.send(target, body, options)) === 'gone') await this.subscriptions.deleteById(row.id);
        }),
      );
    } catch (error) {
      this.logger.error(`Falló el envío de notificaciones: ${(error as Error).message}`);
    }
  }
}
