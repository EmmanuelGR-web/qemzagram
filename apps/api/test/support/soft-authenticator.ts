import { isoCBOR } from '@simplewebauthn/server/helpers';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const b64url = (data: Uint8Array) => Buffer.from(data).toString('base64url');
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();
const u32 = (value: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
const u16 = (value: number) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
};

/**
 * Autenticador WebAuthn por software, SOLO para tests: genera un par de claves P-256 real y arma
 * las respuestas como un dispositivo (CBOR + firma ECDSA), según la especificación W3C WebAuthn.
 * Así se prueba la verificación de verdad de @simplewebauthn, sin simular la librería.
 */
export class SoftAuthenticator {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly credentialId = randomBytes(16);
  private counter = 0;

  constructor(
    private readonly origin: string,
    private readonly rpId = new URL(origin).hostname,
  ) {}

  get id(): string {
    return b64url(this.credentialId);
  }

  /** Respuesta a `navigator.credentials.create` (registro, attestation "none"). */
  register(options: { challenge: string }, overrides: { origin?: string; rpId?: string } = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: overrides.origin ?? this.origin, crossOrigin: false }));
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const coseKey = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, Buffer.from(jwk.x ?? '', 'base64url')],
        [-3, Buffer.from(jwk.y ?? '', 'base64url')],
      ]),
    );
    // flags 0x45 = presencia del usuario (UP) + verificación (UV) + datos de la credencial (AT)
    const authData = Buffer.concat([sha256(overrides.rpId ?? this.rpId), Buffer.from([0x45]), u32(this.counter), Buffer.alloc(16), u16(this.credentialId.length), this.credentialId, coseKey]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, number>>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, number>()],
        ['authData', authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject), transports: ['internal' as const] },
      clientExtensionResults: {},
    };
  }

  /** Respuesta a `navigator.credentials.get` (login): firma authData + hash(clientDataJSON). */
  authenticate(options: { challenge: string }, overrides: { origin?: string; counter?: number } = {}) {
    this.counter = overrides.counter ?? this.counter + 1;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: overrides.origin ?? this.origin, crossOrigin: false }));
    const authData = Buffer.concat([sha256(this.rpId), Buffer.from([0x05]), u32(this.counter)]); // UP + UV
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.keys.privateKey); // DER, como los dispositivos
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature) },
      clientExtensionResults: {},
    };
  }
}
