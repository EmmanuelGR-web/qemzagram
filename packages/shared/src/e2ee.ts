/**
 * Cifrado de extremo a extremo (Fase 7B) con primitivas ESTÁNDAR de WebCrypto:
 * ECDH P-256 (acuerdo de claves) + HKDF-SHA-256 (derivación) + AES-256-GCM (cifrado autenticado)
 * + PBKDF2-SHA-256 (copia de seguridad) + HMAC-SHA-256 (franqueo para denuncias).
 *
 * Funciona igual en el navegador y en Node (los tests de la API usan exactamente este código).
 * El servidor NUNCA recibe claves privadas ni contenido en claro: solo sobres cifrados.
 *
 * Modelo (diseño simple, ver docs/SEGURIDAD.md §2.7):
 * - Cada CUENTA tiene un par de claves ECDH. La privada vive en el dispositivo y viaja al servidor
 *   solo dentro de una copia cifrada con el código de recuperación (que el servidor no conoce).
 * - Cada MENSAJE tiene su propia clave al azar. Esa clave se "envuelve" para cada miembro con
 *   ECDH(privada de quien envía, pública del miembro) → HKDF → AES-GCM.
 * - El envoltorio queda atado al contenido cifrado (sal = SHA-256 del cifrado) y al contexto
 *   (conversación, id del mensaje, quién envía, quién recibe): no se puede mover ni mezclar.
 */
import { z } from 'zod';
import { ALLOWED_FILE_EXTENSIONS, FILE_NAME_MAX_LENGTH, GENERAL_STICKER_CODES, MESSAGE_MAX_LENGTH, UPLOAD_MAX_BYTES_ANY } from './constants';

export const E2EE_VERSION = 1;
/** Iteraciones de PBKDF2 para la copia de seguridad (recomendación OWASP para SHA-256). */
export const E2EE_BACKUP_ITERATIONS = 310_000;
export const E2EE_BACKUP_MIN_ITERATIONS = 100_000;
export const E2EE_BACKUP_MAX_ITERATIONS = 2_000_000;
/** El código de recuperación: 20 bytes al azar (160 bits) en base32 → 32 caracteres en 8 grupos. */
export const RECOVERY_CODE_LENGTH = 32;
/** Tope del contenido descifrado de un mensaje (texto con muchos caracteres escapados + datos del archivo). */
export const E2EE_MAX_PLAINTEXT_BYTES = MESSAGE_MAX_LENGTH * 8 + 4096;

export class E2eeError extends Error {
  constructor(
    public readonly code: 'BAD_CODE' | 'BAD_BACKUP' | 'OTHER_KEY' | 'NOT_FOR_ME' | 'TAMPERED' | 'BAD_CONTENT',
    message: string,
  ) {
    super(message);
    this.name = 'E2eeError';
  }
}

type Bytes = Uint8Array<ArrayBuffer>;
const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const utf8 = (text: string): Bytes => new TextEncoder().encode(text);
const fromUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const copy = (bytes: Uint8Array): Bytes => new Uint8Array(bytes);

export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/* ---------- base64url (sin relleno) ---------- */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new E2eeError('BAD_CONTENT', 'Base64 inválido');
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const b64 = (max: number) => z.string().min(1).max(max).regex(/^[A-Za-z0-9_-]+$/, 'Base64 inválido');

/* ---------- Claves de cuenta ---------- */

/** Clave pública P-256 en formato JWK (solo las coordenadas: nada de la parte privada). */
export const publicKeyJwkSchema = z
  .object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: b64(43).length(43), y: b64(43).length(43) })
  .strict();
export type PublicKeyJwk = z.infer<typeof publicKeyJwkSchema>;

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;

export interface IdentityKeyPair {
  publicJwk: PublicKeyJwk;
  /** Exportable SOLO para armar la copia de seguridad; después se guarda una versión no exportable. */
  privateKey: CryptoKey;
}

export async function generateIdentity(): Promise<IdentityKeyPair> {
  const pair = (await subtle().generateKey(ECDH, true, ['deriveBits'])) as CryptoKeyPair;
  return { publicJwk: await exportPublicJwk(pair.publicKey), privateKey: pair.privateKey };
}

async function exportPublicJwk(key: CryptoKey): Promise<PublicKeyJwk> {
  const jwk = await subtle().exportKey('jwk', key);
  return publicKeyJwkSchema.parse({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
}

export async function importPublicKey(jwk: PublicKeyJwk): Promise<CryptoKey> {
  const parsed = publicKeyJwkSchema.parse(jwk);
  return subtle().importKey('jwk', { ...parsed, ext: true }, ECDH, true, []);
}

/**
 * "Código de seguridad" de una clave pública: 40 cifras en 8 grupos de 5.
 * Dos personas lo comparan en persona (o por otro medio) para detectar que nadie se hizo pasar por la otra.
 */
export async function keyFingerprint(jwk: PublicKeyJwk): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', utf8(`qz-fp-v1|P-256|${jwk.x}|${jwk.y}`)));
  const groups: string[] = [];
  for (let index = 0; index < 8; index++) {
    const value = ((digest[index * 3] ?? 0) << 16) | ((digest[index * 3 + 1] ?? 0) << 8) | (digest[index * 3 + 2] ?? 0);
    groups.push(String(value % 100_000).padStart(5, '0'));
  }
  return groups.join(' ');
}

/* ---------- Código de recuperación y copia de seguridad ---------- */

/** Base32 de Crockford: sin I, L, O ni U (no se confunden al copiarlo a mano). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryCode(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return formatRecoveryCode(output);
}

/** Acepta minúsculas, espacios y guiones, y corrige O→0 e I/L→1. Devuelve null si no es válido. */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== RECOVERY_CODE_LENGTH || [...cleaned].some((char) => !CROCKFORD.includes(char))) return null;
  return cleaned;
}

export function formatRecoveryCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? []).join('-');
}

export const keyBackupSchema = z
  .object({
    v: z.literal(1),
    kdf: z.literal('PBKDF2-SHA256'),
    iterations: z.number().int().min(E2EE_BACKUP_MIN_ITERATIONS).max(E2EE_BACKUP_MAX_ITERATIONS),
    salt: b64(64),
    iv: b64(16),
    ct: b64(512),
  })
  .strict();
export type KeyBackup = z.infer<typeof keyBackupSchema>;

const backupAad = (userId: string) => utf8(`qz-backup-v1|${userId}`);

async function backupKey(code: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) throw new E2eeError('BAD_CODE', 'El código de recuperación no es válido');
  const base = await subtle().importKey('raw', utf8(normalized), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Cifra la clave privada con el código de recuperación. El resultado se puede guardar en el servidor. */
export async function encryptKeyBackup(privateKey: CryptoKey, userId: string, code: string, iterations = E2EE_BACKUP_ITERATIONS): Promise<KeyBackup> {
  const jwk = await subtle().exportKey('jwk', privateKey);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await backupKey(code, salt, iterations);
  const plain = utf8(JSON.stringify({ d: jwk.d, x: jwk.x, y: jwk.y }));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: backupAad(userId) }, key, plain));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toBase64Url(salt), iv: toBase64Url(iv), ct: toBase64Url(ct) };
}

const privatePartsSchema = z.object({ d: b64(43).length(43), x: b64(43).length(43), y: b64(43).length(43) }).strict();

/**
 * Abre la copia con el código. Devuelve la clave privada NO EXPORTABLE (ni un script malicioso
 * puede sacarla del navegador en crudo) y la pública que le corresponde.
 */
export async function decryptKeyBackup(backup: KeyBackup, userId: string, code: string): Promise<{ privateKey: CryptoKey; publicJwk: PublicKeyJwk }> {
  const parsed = keyBackupSchema.parse(backup);
  const key = await backupKey(code, fromBase64Url(parsed.salt), parsed.iterations);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64Url(parsed.iv), additionalData: backupAad(userId) }, key, fromBase64Url(parsed.ct)));
  } catch {
    throw new E2eeError('BAD_CODE', 'El código de recuperación no corresponde a esta cuenta');
  }
  const parts = privatePartsSchema.safeParse(JSON.parse(fromUtf8(plain)));
  if (!parts.success) throw new E2eeError('BAD_BACKUP', 'La copia de seguridad está dañada');
  const privateKey = await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', ...parts.data, ext: false }, ECDH, false, ['deriveBits']);
  return { privateKey, publicJwk: { kty: 'EC', crv: 'P-256', x: parts.data.x, y: parts.data.y } };
}

/** Versión no exportable de una clave privada recién generada (para guardarla en el dispositivo). */
export async function toNonExtractable(privateKey: CryptoKey): Promise<CryptoKey> {
  const jwk = await subtle().exportKey('jwk', privateKey);
  return subtle().importKey('jwk', { ...jwk, ext: false, key_ops: ['deriveBits'] }, ECDH, false, ['deriveBits']);
}

/* ---------- Sobres: una clave al azar envuelta para cada miembro ---------- */

export const E2EE_PURPOSES = ['msg', 'call'] as const;
export type E2eePurpose = (typeof E2EE_PURPOSES)[number];

export const wrappedKeySchema = z.object({ k: z.string().uuid(), iv: b64(16), w: b64(64) }).strict();
export const envelopeSchema = z
  .object({
    v: z.literal(1),
    /** Id de la clave de quien envía (para buscar su clave pública aunque después la cambie). */
    sk: z.string().uuid(),
    iv: b64(16),
    ct: b64(Math.ceil(((E2EE_MAX_PLAINTEXT_BYTES + 16) * 4) / 3)),
    keys: z.record(z.string().uuid(), wrappedKeySchema),
  })
  .strict()
  .refine((value) => Object.keys(value.keys).length >= 1 && Object.keys(value.keys).length <= 10, 'Cantidad de destinatarios inválida');
export type E2eeEnvelope = z.infer<typeof envelopeSchema>;

export interface EnvelopeContext {
  purpose: E2eePurpose;
  conversationId: string;
  /** Id del mensaje (o de la llamada): lo genera el cliente antes de cifrar. */
  objectId: string;
  senderId: string;
}

export interface Recipient {
  userId: string;
  keyId: string;
  publicJwk: PublicKeyJwk;
}

const contentAad = (ctx: EnvelopeContext) => utf8(`qz-${ctx.purpose}-v1|${ctx.conversationId}|${ctx.objectId}|${ctx.senderId}`);

/** Clave para envolver: solo la pueden calcular quien envía y ese destinatario (ECDH estático-estático). */
async function wrappingKey(own: CryptoKey, other: CryptoKey, ctx: EnvelopeContext, recipientId: string, recipientKeyId: string, ct: Uint8Array): Promise<CryptoKey> {
  const shared = await subtle().deriveBits({ name: 'ECDH', public: other }, own, 256);
  const base = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(await subtle().digest('SHA-256', copy(ct)));
  const info = utf8(`qz-wrap-v1|${ctx.purpose}|${ctx.conversationId}|${ctx.objectId}|${ctx.senderId}|${recipientId}|${recipientKeyId}`);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealEnvelope(
  plain: Uint8Array,
  ctx: EnvelopeContext,
  sender: { keyId: string; privateKey: CryptoKey },
  recipients: Recipient[],
): Promise<E2eeEnvelope> {
  const contentKeyBytes = randomBytes(32);
  const contentKey = await subtle().importKey('raw', contentKeyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: contentAad(ctx) }, contentKey, copy(plain)));
  const keys: Record<string, z.infer<typeof wrappedKeySchema>> = {};
  for (const recipient of recipients) {
    const kek = await wrappingKey(sender.privateKey, await importPublicKey(recipient.publicJwk), ctx, recipient.userId, recipient.keyId, ct);
    const wrapIv = randomBytes(12);
    const wrapped = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: wrapIv }, kek, contentKeyBytes));
    keys[recipient.userId] = { k: recipient.keyId, iv: toBase64Url(wrapIv), w: toBase64Url(wrapped) };
  }
  return { v: 1, sk: sender.keyId, iv: toBase64Url(iv), ct: toBase64Url(ct), keys };
}

export async function openEnvelope(
  envelope: E2eeEnvelope,
  ctx: EnvelopeContext,
  me: { userId: string; keyId: string; privateKey: CryptoKey },
  senderPublicJwk: PublicKeyJwk,
): Promise<Bytes> {
  const parsed = envelopeSchema.parse(envelope);
  const mine = parsed.keys[me.userId];
  if (!mine) throw new E2eeError('NOT_FOR_ME', 'Este mensaje no fue cifrado para vos');
  if (mine.k !== me.keyId) throw new E2eeError('OTHER_KEY', 'Este mensaje se cifró para una clave anterior');
  const ct = fromBase64Url(parsed.ct);
  try {
    const kek = await wrappingKey(me.privateKey, await importPublicKey(senderPublicJwk), ctx, me.userId, me.keyId, ct);
    const contentKeyBytes = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64Url(mine.iv) }, kek, fromBase64Url(mine.w)));
    const contentKey = await subtle().importKey('raw', contentKeyBytes, 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64Url(parsed.iv), additionalData: contentAad(ctx) }, contentKey, ct));
  } catch {
    throw new E2eeError('TAMPERED', 'El mensaje fue alterado o no es de quien dice ser');
  }
}

/* ---------- Contenido de un mensaje + franqueo (para denuncias verificables) ---------- */

export const E2EE_FILE_KINDS = ['image', 'video', 'audio', 'file', 'sticker'] as const;
/** Tipos que la app MUESTRA dentro del chat. Cualquier otro se ofrece solo como descarga. */
export const E2EE_INLINE_MIME: Record<'image' | 'video' | 'audio' | 'sticker', readonly string[]> = {
  image: ['image/webp', 'image/jpeg', 'image/png'],
  sticker: ['image/webp', 'image/png'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'],
};

const fileNameSchema = z
  .string()
  .min(1)
  .max(FILE_NAME_MAX_LENGTH)
  .refine((name) => !/[\\/\u0000-\u001f]/.test(name), 'Nombre de archivo inválido')
  .refine((name) => (ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(name.split('.').pop()?.toLowerCase() ?? ''), 'Tipo de documento no permitido');

export const e2eeFileRefSchema = z
  .object({
    /** Id del adjunto en el servidor (el archivo cifrado queda atado a este id). */
    id: z.string().uuid(),
    /** Clave AES-256 del archivo (solo la conocen los miembros). */
    key: b64(43).length(43),
    kind: z.enum(E2EE_FILE_KINDS),
    mime: z.string().min(3).max(100),
    name: fileNameSchema.nullable(),
    size: z.number().int().min(1).max(UPLOAD_MAX_BYTES_ANY),
    w: z.number().int().min(1).max(10_000).nullable(),
    h: z.number().int().min(1).max(10_000).nullable(),
    dur: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable(),
  })
  .strict()
  .refine((file) => file.kind === 'file' || E2EE_INLINE_MIME[file.kind].includes(file.mime), 'Tipo de archivo no permitido')
  .refine((file) => (file.kind === 'file') === (file.name !== null), 'Solo los documentos llevan nombre');
export type E2eeFileRef = z.infer<typeof e2eeFileRefSchema>;

export const e2eeContentSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('text'), body: z.string().min(1).max(MESSAGE_MAX_LENGTH) }).strict(),
  z.object({ t: z.literal('sticker'), code: z.enum(GENERAL_STICKER_CODES) }).strict(),
  z.object({ t: z.literal('file'), body: z.string().max(MESSAGE_MAX_LENGTH), file: e2eeFileRefSchema }).strict(),
]);
export type E2eeContent = z.infer<typeof e2eeContentSchema>;

/**
 * Franqueo (message franking): quien envía sortea una clave `fk`, la mete DENTRO del cifrado y
 * publica `commitment = HMAC(fk, contenido)`. El servidor guarda el compromiso junto al mensaje.
 * - Quien recibe verifica el compromiso: si no coincide, el mensaje NO se muestra (así nadie puede
 *   mandar algo que después no se pueda denunciar).
 * - Para denunciar, el dispositivo revela `contenido + fk`; el servidor recalcula el HMAC y comprueba
 *   que el mensaje es auténtico (nadie lo inventó ni lo editó), sin haber podido leerlo antes.
 */
export async function franking(fk: Uint8Array, content: string): Promise<string> {
  const key = await subtle().importKey('raw', copy(fk), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await subtle().sign('HMAC', key, utf8(content))));
}

/** Comparación en tiempo constante (la hace WebCrypto). */
export async function verifyFranking(fkB64: string, content: string, commitmentB64: string): Promise<boolean> {
  try {
    const key = await subtle().importKey('raw', fromBase64Url(fkB64), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await subtle().verify('HMAC', key, fromBase64Url(commitmentB64), utf8(content));
  } catch {
    return false;
  }
}

/** Lo que va dentro del sobre: el contenido serializado y la clave de franqueo. */
const innerSchema = z.object({ fk: b64(43).length(43), c: z.string().min(1).max(MESSAGE_MAX_LENGTH * 6 + 2048) }).strict();

export interface SealedMessage {
  envelope: E2eeEnvelope;
  commitment: string;
}

export async function sealMessage(
  content: E2eeContent,
  ctx: Omit<EnvelopeContext, 'purpose'>,
  sender: { keyId: string; privateKey: CryptoKey },
  recipients: Recipient[],
): Promise<SealedMessage> {
  const serialized = JSON.stringify(e2eeContentSchema.parse(content));
  const fk = randomBytes(32);
  const commitment = await franking(fk, serialized);
  const inner = utf8(JSON.stringify({ fk: toBase64Url(fk), c: serialized }));
  if (inner.length > E2EE_MAX_PLAINTEXT_BYTES) throw new E2eeError('BAD_CONTENT', 'El mensaje es demasiado largo');
  return { envelope: await sealEnvelope(inner, { ...ctx, purpose: 'msg' }, sender, recipients), commitment };
}

export interface OpenedMessage {
  content: E2eeContent;
  /** Para denunciar: el texto exacto que se comprometió y la clave de franqueo. */
  reveal: { content: string; fk: string };
}

export async function openMessage(
  envelope: E2eeEnvelope,
  commitment: string,
  ctx: Omit<EnvelopeContext, 'purpose'>,
  me: { userId: string; keyId: string; privateKey: CryptoKey },
  senderPublicJwk: PublicKeyJwk,
): Promise<OpenedMessage> {
  const plain = await openEnvelope(envelope, { ...ctx, purpose: 'msg' }, me, senderPublicJwk);
  const inner = innerSchema.safeParse(safeJson(fromUtf8(plain)));
  if (!inner.success) throw new E2eeError('BAD_CONTENT', 'Contenido inválido');
  if (!(await verifyFranking(inner.data.fk, inner.data.c, commitment))) throw new E2eeError('TAMPERED', 'El franqueo no coincide');
  return { content: parseE2eeContent(inner.data.c), reveal: { content: inner.data.c, fk: inner.data.fk } };
}

/** Valida el contenido descifrado (quien envía podría mandar cualquier cosa). */
export function parseE2eeContent(serialized: string): E2eeContent {
  const parsed = e2eeContentSchema.safeParse(safeJson(serialized));
  if (!parsed.success) throw new E2eeError('BAD_CONTENT', 'Contenido inválido');
  return parsed.data;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ---------- Archivos ---------- */

const fileAad = (attachmentId: string) => utf8(`qz-file-v1|${attachmentId}`);

/** Cifra un archivo con una clave nueva. Formato: iv (12 bytes) ‖ cifrado ‖ etiqueta GCM (16 bytes). */
export async function encryptFile(data: Uint8Array, attachmentId: string): Promise<{ key: string; blob: Bytes }> {
  const keyBytes = randomBytes(32);
  const key = await subtle().importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: fileAad(attachmentId) }, key, copy(data)));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv, 0);
  blob.set(ct, iv.length);
  return { key: toBase64Url(keyBytes), blob };
}

export async function decryptFile(blob: Uint8Array, keyB64: string, attachmentId: string): Promise<Bytes> {
  if (blob.length < 12 + 16) throw new E2eeError('TAMPERED', 'Archivo dañado');
  try {
    const key = await subtle().importKey('raw', fromBase64Url(keyB64), 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: copy(blob.subarray(0, 12)), additionalData: fileAad(attachmentId) }, key, copy(blob.subarray(12))));
  } catch {
    throw new E2eeError('TAMPERED', 'El archivo fue alterado');
  }
}

/** Tamaño del archivo cifrado para un original de `size` bytes. */
export const encryptedFileSize = (size: number) => size + 12 + 16;

/* ---------- Llamadas ---------- */

/** Clave de una llamada (para el cifrado de extremo a extremo de LiveKit), envuelta para cada miembro. */
export async function sealCallKey(
  ctx: Omit<EnvelopeContext, 'purpose'>,
  sender: { keyId: string; privateKey: CryptoKey },
  recipients: Recipient[],
): Promise<{ envelope: E2eeEnvelope; key: Bytes }> {
  const key = randomBytes(32);
  return { envelope: await sealEnvelope(key, { ...ctx, purpose: 'call' }, sender, recipients), key };
}

export async function openCallKey(
  envelope: E2eeEnvelope,
  ctx: Omit<EnvelopeContext, 'purpose'>,
  me: { userId: string; keyId: string; privateKey: CryptoKey },
  senderPublicJwk: PublicKeyJwk,
): Promise<Bytes> {
  const key = await openEnvelope(envelope, { ...ctx, purpose: 'call' }, me, senderPublicJwk);
  if (key.length !== 32) throw new E2eeError('BAD_CONTENT', 'Clave de llamada inválida');
  return key;
}

/* ---------- API: claves ---------- */

/**
 * Publicar mi clave. La primera vez no pide contraseña. Si ya hay una activa (perdiste el código y
 * generás claves nuevas), exige la contraseña: el historial cifrado con la clave anterior se pierde.
 */
export const e2eePublishKeySchema = z
  .object({
    publicKey: publicKeyJwkSchema,
    backup: keyBackupSchema,
    password: z.string().min(1).max(128).optional(),
  })
  .strict();
export type E2eePublishKeyInput = z.infer<typeof e2eePublishKeySchema>;

export const e2eeKeyLookupSchema = z
  .object({ ids: z.array(z.string().uuid()).min(1).max(50) })
  .strict()
  .refine((value) => new Set(value.ids).size === value.ids.length, 'Hay ids repetidos');

export interface E2eeKeyDto {
  id: string;
  userId: string;
  publicKey: PublicKeyJwk;
  createdAt: string;
  /** false = clave reemplazada (sirve solo para verificar mensajes viejos). */
  active: boolean;
}

export interface MyE2eeKeyDto {
  key: E2eeKeyDto | null;
  /** Copia cifrada con el código de recuperación (el servidor no puede abrirla). */
  backup: KeyBackup | null;
}

/**
 * Claves de los miembros ACTUALES y activos de una conversación (las cuentas suspendidas o dadas de baja no figuran).
 * `key: null` = esa persona todavía no activó el cifrado: el chat no es de extremo a extremo.
 */
export interface ConversationKeysDto {
  members: { userId: string; key: E2eeKeyDto | null }[];
}

/* ---------- API: mensajes ---------- */

/** Enviar un mensaje cifrado. El id lo genera el dispositivo (el cifrado queda atado a ese id). */
export const sendE2eeMessageSchema = z
  .object({
    id: z.string().uuid(),
    envelope: envelopeSchema,
    commitment: b64(43).length(43),
  })
  .strict();
export type SendE2eeMessageInput = z.infer<typeof sendE2eeMessageSchema>;

/* ---------- API: adjuntos ---------- */

/** Tamaño máximo del archivo CIFRADO que se sube (el original más el iv y la etiqueta). */
export const E2EE_UPLOAD_MAX_BYTES = encryptedFileSize(UPLOAD_MAX_BYTES_ANY);

export const sendE2eeAttachmentMetaSchema = z
  .object({
    id: z.string().uuid(),
    attachmentId: z.string().uuid(),
    envelope: envelopeSchema,
    commitment: b64(43).length(43),
  })
  .strict()
  .refine((value) => value.id !== value.attachmentId, 'Ids repetidos');
export type SendE2eeAttachmentMeta = z.infer<typeof sendE2eeAttachmentMetaSchema>;

/** Formulario multipart: el campo `meta` (JSON) acompaña al archivo cifrado. */
export const sendE2eeAttachmentFormSchema = z
  .object({
    meta: z
      .string()
      .max(200_000)
      .transform((text, ctx) => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Datos del adjunto inválidos' });
          return z.NEVER;
        }
      })
      .pipe(sendE2eeAttachmentMetaSchema),
  })
  .strict();
