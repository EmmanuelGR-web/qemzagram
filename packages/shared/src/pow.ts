/**
 * Prueba de trabajo ("CAPTCHA" sin terceros, estilo Hashcash): el navegador busca un número `nonce`
 * tal que SHA-256("<desafío>:<nonce>") empiece con `difficulty` bits en cero. Para una persona son
 * 1–2 segundos; para un bot que quiere crear miles de cuentas, miles de veces eso.
 *
 * SHA-256 está implementado acá en TypeScript puro (FIPS 180-4) para que funcione igual en cualquier
 * navegador, incluso sin `crypto.subtle` (que solo existe con HTTPS o en localhost). El servidor
 * verifica con el SHA-256 de Node, y los tests comparan ambas implementaciones.
 */

export const POW_PURPOSES = ['register', 'login', 'forgot', 'resend', 'appeal'] as const;
export type PowPurpose = (typeof POW_PURPOSES)[number];
/** Cabecera donde viaja la solución: "<desafío>:<nonce>". */
export const POW_HEADER = 'x-qz-pow';
export const POW_TTL_SECONDS = 5 * 60;
/** Nonce máximo aceptado (32 bits): acota el trabajo del servidor al validar. */
export const POW_MAX_NONCE = 0xffffffff;

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

/** SHA-256 (FIPS 180-4). Devuelve los 32 bytes del resumen. */
export function sha256(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const paddedLength = Math.ceil((data.length + 9) / 64) * 64;
  const block = new Uint8Array(paddedLength);
  block.set(data);
  block[data.length] = 0x80;
  const view = new DataView(block.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) w[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const w15 = w[index - 15] ?? 0;
      const w2 = w[index - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[index] = ((w[index - 16] ?? 0) + s0 + (w[index - 7] ?? 0) + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [hash[0] ?? 0, hash[1] ?? 0, hash[2] ?? 0, hash[3] ?? 0, hash[4] ?? 0, hash[5] ?? 0, hash[6] ?? 0, hash[7] ?? 0];
    for (let index = 0; index < 64; index++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + (K[index] ?? 0) + (w[index] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = ((hash[0] ?? 0) + a) >>> 0;
    hash[1] = ((hash[1] ?? 0) + b) >>> 0;
    hash[2] = ((hash[2] ?? 0) + c) >>> 0;
    hash[3] = ((hash[3] ?? 0) + d) >>> 0;
    hash[4] = ((hash[4] ?? 0) + e) >>> 0;
    hash[5] = ((hash[5] ?? 0) + f) >>> 0;
    hash[6] = ((hash[6] ?? 0) + g) >>> 0;
    hash[7] = ((hash[7] ?? 0) + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let index = 0; index < 8; index++) outView.setUint32(index * 4, hash[index] ?? 0);
  return out;
}

/** Cantidad de bits en cero al principio del resumen. */
export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

const encoder = new TextEncoder();

export function powDigest(challenge: string, nonce: number): Uint8Array {
  return sha256(encoder.encode(`${challenge}:${nonce}`));
}

/**
 * Busca una solución probando `count` nonces desde `start`. Devuelve el nonce o null.
 * El navegador lo llama en tandas (cediendo el control entre tandas) para no congelar la pantalla.
 */
export function solvePowChunk(challenge: string, difficulty: number, start: number, count: number): number | null {
  const end = Math.min(start + count, POW_MAX_NONCE);
  for (let nonce = start; nonce < end; nonce++) {
    if (leadingZeroBits(powDigest(challenge, nonce)) >= difficulty) return nonce;
  }
  return null;
}
