import {
  E2EE_BACKUP_MIN_ITERATIONS,
  encryptKeyBackup,
  generateIdentity,
  generateRecoveryCode,
  type ConversationKeysDto,
  type MyE2eeKeyDto,
  type PublicKeyJwk,
  type Recipient,
} from '@qemzagram/shared';
import type { TestUser } from './test-app';

/**
 * "Dispositivo" de prueba: usa EXACTAMENTE la misma biblioteca que la web (@qemzagram/shared/e2ee).
 * Así los tests prueban el protocolo real, no una imitación.
 */
export interface E2eeDevice {
  user: TestUser;
  keyId: string;
  privateKey: CryptoKey;
  publicJwk: PublicKeyJwk;
  recoveryCode: string;
}

/** Genera las claves de la cuenta, arma la copia cifrada y la publica (PBKDF2 con el mínimo para que los tests sean rápidos). */
export async function setupE2ee(user: TestUser, password?: string): Promise<E2eeDevice> {
  const identity = await generateIdentity();
  const recoveryCode = generateRecoveryCode();
  const backup = await encryptKeyBackup(identity.privateKey, user.id, recoveryCode, E2EE_BACKUP_MIN_ITERATIONS);
  const response = await user.agent
    .post('/e2ee/keys')
    .send({ publicKey: identity.publicJwk, backup, ...(password ? { password } : {}) })
    .expect(201);
  const body = response.body as MyE2eeKeyDto;
  if (!body.key) throw new Error('No se publicó la clave');
  return { user, keyId: body.key.id, privateKey: identity.privateKey, publicJwk: identity.publicJwk, recoveryCode };
}

/** Destinatarios de un mensaje: las claves activas de los miembros actuales (las pide el dispositivo). */
export async function recipientsFor(device: E2eeDevice, conversationId: string): Promise<Recipient[]> {
  const response = await device.user.agent.get(`/e2ee/conversations/${conversationId}/keys`).expect(200);
  return (response.body as ConversationKeysDto).members.flatMap((member) =>
    member.key ? [{ userId: member.userId, keyId: member.key.id, publicJwk: member.key.publicKey }] : [],
  );
}
