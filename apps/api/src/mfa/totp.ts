import { TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '@qemzagram/shared';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * TOTP estándar (RFC 6238 sobre HOTP, RFC 4226) con HMAC-SHA1, 6 dígitos y pasos de 30 s:
 * lo que esperan Google Authenticator, Authy, Microsoft Authenticator, 1Password, etc.
 * No es criptografía inventada: es el algoritmo publicado, verificado con los vectores del RFC.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Códigos de respaldo: sin I, O, 0 ni 1 para que no se confundan al copiarlos. */
const BACKUP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Base32 inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Secreto nuevo de 160 bits (lo recomendado por el RFC para HMAC-SHA1). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP: HMAC-SHA1 del contador y "truncado dinámico" a `digits` dígitos. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = (((hmac[offset] ?? 0) & 0x7f) << 24) | ((hmac[offset + 1] ?? 0) << 16) | ((hmac[offset + 2] ?? 0) << 8) | (hmac[offset + 3] ?? 0);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export const totpStep = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);

export function totpCode(secretBase32: string, nowMs = Date.now()): string {
  return hotp(base32Decode(secretBase32), totpStep(nowMs));
}

/**
 * Verifica un código aceptando ±1 paso (el reloj del celular puede estar corrido unos segundos).
 * Devuelve el paso usado, o null. Rechaza pasos ya usados (`lastStep`): un código robado
 * mirando la pantalla no sirve una segunda vez.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, lastStep: number | null): number | null {
  const secret = base32Decode(secretBase32);
  const current = totpStep(nowMs);
  const received = Buffer.from(code);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (expected.length === received.length && timingSafeEqual(expected, received)) return step;
  }
  return null;
}

export function otpauthUrl(account: string, secretBase32: string): string {
  const label = encodeURIComponent(`Qemzagram:@${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer: 'Qemzagram', algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Código de respaldo de 8 caracteres (~40 bits). Se muestra como "ABCD-EFGH". */
export function generateBackupCode(): string {
  let code = '';
  for (let index = 0; index < 8; index++) code += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
  return code;
}

export const formatBackupCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;
export const normalizeBackupCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
