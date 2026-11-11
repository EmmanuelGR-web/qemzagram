import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { ENV, type AppEnv } from '../config/env';

const ENCRYPTION_VERSION = 'v1';
/** Primer byte de un archivo cifrado: permite cambiar el formato en el futuro. */
const BLOB_VERSION = 1;

@Injectable()
export class CryptoService {
  private readonly encryptionKey: Buffer;
  private readonly pepper: Buffer;
  /** Claves derivadas (HKDF) de MESSAGE_ENC_KEY: una por uso, para que nunca se mezclen. */
  private readonly blobKey: Buffer;
  private readonly urlSigningKey: Buffer;
  private dummyHash?: Promise<string>;

  constructor(@Inject(ENV) env: AppEnv) {
    this.encryptionKey = Buffer.from(env.MESSAGE_ENC_KEY, 'base64');
    this.pepper = Buffer.from(env.PASSWORD_PEPPER, 'utf8');
    this.blobKey = this.deriveKey('qemzagram/media-blob/v1');
    this.urlSigningKey = this.deriveKey('qemzagram/media-url/v1');
  }

  private deriveKey(label: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.encryptionKey, Buffer.alloc(0), label, 32));
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
    // "data" puede ser una cadena vacía (texto vacío, p. ej. una foto sin comentario): solo se exige que exista.
    if (version !== ENCRYPTION_VERSION || !iv || !tag || data === undefined) throw new Error('Formato de cifrado desconocido');
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  /**
   * Cifra un archivo completo (adjuntos y stickers) con AES-256-GCM.
   * Formato: [versión (1 byte)][iv (12)][tag (16)][datos]. `aad` = id del adjunto/sticker.
   */
  encryptBlob(plain: Buffer, aad: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.blobKey, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([Buffer.from([BLOB_VERSION]), iv, cipher.getAuthTag(), encrypted]);
  }

  decryptBlob(payload: Buffer, aad: string): Buffer {
    if (payload.length < 29 || payload[0] !== BLOB_VERSION) throw new Error('Formato de archivo cifrado desconocido');
    const decipher = createDecipheriv('aes-256-gcm', this.blobKey, payload.subarray(1, 13));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(payload.subarray(13, 29));
    return Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]);
  }

  /** Firma HMAC-SHA256 para URLs de archivos (base64url). */
  signUrl(value: string): string {
    return createHmac('sha256', this.urlSigningKey).update(value).digest('base64url');
  }

  /** Compara una firma recibida en tiempo constante (evita ataques de temporización). */
  verifyUrlSignature(value: string, signature: string): boolean {
    const expected = Buffer.from(this.signUrl(value));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }
}
