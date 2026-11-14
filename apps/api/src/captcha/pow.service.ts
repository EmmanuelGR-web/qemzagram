import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { leadingZeroBits, POW_MAX_NONCE, POW_PURPOSES, POW_TTL_SECONDS, type PowChallengeDto, type PowPurpose } from '@qemzagram/shared';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ENV, type AppEnv } from '../config/env';
import { KeyValueStore } from '../kv/kv.port';

const POW_REQUIRED = { code: 'POW_REQUIRED', message: 'Falta la verificación anti-bots. Recargá la página y probá de nuevo.' };
const POW_INVALID = { code: 'POW_INVALID', message: 'La verificación anti-bots no es válida o venció. Probá de nuevo.' };

/**
 * Prueba de trabajo SIN estado en el servidor para emitir: el desafío lleva propósito, dificultad,
 * vencimiento y un valor al azar, firmados con HMAC. Al usarlo se recuerda (hasta que vence) para
 * que la misma solución no sirva dos veces.
 */
@Injectable()
export class PowService {
  private readonly key: Buffer;
  readonly enabled: boolean;
  private readonly difficulty: number;

  constructor(
    @Inject(ENV) env: AppEnv,
    private readonly store: KeyValueStore,
  ) {
    // Clave propia derivada del secreto de tickets (no se reutiliza para otra cosa).
    this.key = createHmac('sha256', env.JWT_TICKET_SECRET).update('qemzagram/pow/v1').digest();
    this.enabled = env.POW_ENABLED === 'true';
    this.difficulty = env.POW_DIFFICULTY;
  }

  issue(purpose: PowPurpose, now = Date.now()): PowChallengeDto {
    const expires = Math.floor(now / 1000) + POW_TTL_SECONDS;
    const body = `v1.${purpose}.${this.difficulty}.${expires}.${randomBytes(12).toString('base64url')}`;
    return { challenge: `${body}.${this.sign(body)}`, difficulty: this.difficulty, expiresAt: new Date(expires * 1000).toISOString() };
  }

  /** Valida la cabecera "<desafío>:<nonce>" para ese propósito. Lanza 400 si falta o no sirve. */
  async verify(header: string | undefined, purpose: PowPurpose, now = Date.now()): Promise<void> {
    if (!this.enabled) return;
    if (!header) throw new BadRequestException(POW_REQUIRED);
    const separator = header.lastIndexOf(':');
    const challenge = header.slice(0, separator);
    const nonceText = header.slice(separator + 1);
    if (separator <= 0 || header.length > 300 || !/^\d{1,10}$/.test(nonceText)) throw new BadRequestException(POW_INVALID);

    const parts = challenge.split('.');
    if (parts.length !== 6) throw new BadRequestException(POW_INVALID);
    const [version, challengePurpose, difficultyText, expiresText, , signature] = parts;
    const body = parts.slice(0, 5).join('.');
    const expected = Buffer.from(this.sign(body));
    const received = Buffer.from(signature ?? '');
    const nonce = Number(nonceText);
    const difficulty = Number(difficultyText);
    const expires = Number(expiresText);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received) ||
      version !== 'v1' ||
      challengePurpose !== purpose ||
      !(POW_PURPOSES as readonly string[]).includes(challengePurpose) ||
      // Un desafío emitido con menos dificultad que la actual no se acepta.
      !Number.isInteger(difficulty) ||
      difficulty < this.difficulty ||
      !Number.isInteger(expires) ||
      expires * 1000 <= now ||
      nonce > POW_MAX_NONCE
    ) {
      throw new BadRequestException(POW_INVALID);
    }
    const digest = createHash('sha256').update(`${challenge}:${nonce}`).digest();
    if (leadingZeroBits(digest) < difficulty) throw new BadRequestException(POW_INVALID);
    // Un solo uso: se recuerda el desafío hasta que vence.
    const fresh = await this.store.setIfAbsent(`pow:${createHash('sha256').update(challenge).digest('hex')}`, expires * 1000 - now);
    if (!fresh) throw new BadRequestException(POW_INVALID);
  }

  private sign(body: string): string {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }
}
