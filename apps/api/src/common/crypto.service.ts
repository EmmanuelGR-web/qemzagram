import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ENV, type AppEnv } from '../config/env';

const ENCRYPTION_VERSION = 'v1';

@Injectable()
export class CryptoService {
  private readonly encryptionKey: Buffer;
  private readonly pepper: Buffer;
  private dummyHash?: Promise<string>;

  constructor(@Inject(ENV) env: AppEnv) {
    this.encryptionKey = Buffer.from(env.MESSAGE_ENC_KEY, 'base64');
    this.pepper = Buffer.from(env.PASSWORD_PEPPER, 'utf8');
  }

  /** Argon2id (ganador de la Password Hashing Competition) + pepper secreto del servidor. */
  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456, // 19 MiB (recomendación OWASP)
      timeCost: 2,
      parallelism: 1,
      secret: this.pepper,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password, { secret: this.pepper });
    } catch {
      return false;
    }
  }

  /** Gasta el mismo tiempo que una verificación real para no revelar si un usuario existe. */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hashPassword(randomBytes(16).toString('hex'));
    await this.verifyPassword(await this.dummyHash, password);
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /**
   * Cifrado AES-256-GCM. `aad` (datos asociados, p. ej. el id de la conversación)
   * ata el texto cifrado a su contexto: copiarlo a otra conversación lo invalida.
   */
  encryptText(plain: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENCRYPTION_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  decryptText(payload: string, aad: string): string {
    const [version, iv, tag, data] = payload.split('.');
    if (version !== ENCRYPTION_VERSION || !iv || !tag || !data) throw new Error('Formato de cifrado desconocido');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
