import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  PASSKEYS_MAX,
  WEBAUTHN_TRANSPORTS,
  type PasskeyDto,
  type PasskeyRegisteredDto,
  type WebAuthnAuthenticationInput,
  type WebAuthnRegistrationInput,
} from '@qemzagram/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { ENV, type AppEnv } from '../config/env';
import { PasskeysRepository } from '../database/repositories/passkeys.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { PasskeyRow, UserRow } from '../database/schema';
import { MailPort } from '../mail/mail.port';
import { MfaService } from './mfa.service';

const CHALLENGE_MS = 5 * 60 * 1000;
const challengeAad = (userId: string) => `webauthn-challenge:${userId}`;
const INVALID_PASSKEY = { code: 'PASSKEY_INVALID', message: 'No pudimos verificar la llave de acceso. Probá de nuevo.' };
type Transport = (typeof WEBAUTHN_TRANSPORTS)[number];

const toDto = (row: PasskeyRow): PasskeyDto => ({
  id: row.id,
  name: row.name,
  backedUp: row.backedUp,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
});

const parseTransports = (value: string): Transport[] =>
  value.split(',').filter((item): item is Transport => (WEBAUTHN_TRANSPORTS as readonly string[]).includes(item));

/**
 * Llaves de acceso (WebAuthn) como segundo factor, con la librería estándar @simplewebauthn.
 * La firma la hace el dispositivo con una clave privada que nunca sale de él; el servidor guarda
 * solo la clave pública. La llave queda atada al dominio (rpID): una página falsa no puede usarla
 * (protección contra phishing que el TOTP no tiene).
 */
@Injectable()
export class PasskeysService {
  private readonly rpID: string;
  private readonly origin: string;

  constructor(
    private readonly passkeys: PasskeysRepository,
    private readonly users: UsersRepository,
    private readonly mfa: MfaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailPort,
    private readonly audit: AuditService,
    @Inject(ENV) env: AppEnv,
  ) {
    this.origin = env.WEB_ORIGIN;
    this.rpID = new URL(env.WEB_ORIGIN).hostname;
  }

  async list(userId: string): Promise<PasskeyDto[]> {
    return (await this.passkeys.listForUser(userId)).map(toDto);
  }

  /** Paso 1 del registro (con contraseña): opciones para `navigator.credentials.create`. */
  async registrationOptions(userId: string, password: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.requirePassword(userId, password);
    const existing = await this.passkeys.listForUser(userId);
    if (existing.length >= PASSKEYS_MAX) throw new ConflictException({ code: 'PASSKEYS_LIMIT', message: `Podés tener hasta ${PASSKEYS_MAX} llaves de acceso` });
    const options = await generateRegistrationOptions({
      rpName: 'Qemzagram',
      rpID: this.rpID,
      userName: user.tag,
      userDisplayName: user.displayName,
      userID: isoUint8Array.fromUTF8String(user.id),
      attestationType: 'none', // no pedimos datos del fabricante: más privacidad
      excludeCredentials: existing.map((item) => ({ id: item.credentialId, transports: parseTransports(item.transports) })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await this.saveChallenge(user.id, options.challenge);
    return options;
  }

  /** Paso 2 del registro: verifica la respuesta del dispositivo y guarda la clave pública. */
  async register(userId: string, name: string, response: WebAuthnRegistrationInput): Promise<PasskeyRegisteredDto> {
    const user = await this.requireUser(userId);
    const expectedChallenge = await this.takeChallenge(user);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: { ...response, clientExtensionResults: {} },
        expectedChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: false,
      });
    } catch {
      throw new BadRequestException(INVALID_PASSKEY);
    }
    if (!verification.verified) throw new BadRequestException(INVALID_PASSKEY);
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    if (await this.passkeys.existsCredential(credential.id)) throw new ConflictException({ code: 'PASSKEY_EXISTS', message: 'Esa llave de acceso ya está registrada' });

    const row = await this.passkeys.create({
      userId,
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: (credential.transports ?? []).join(','),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      name,
    });
    await this.users.update(userId, { mfaEnabled: true });
    // Sin códigos de respaldo (primer segundo factor), se entregan ahora: por si se pierde el dispositivo.
    const backupCodes = (await this.mfa.backupCodesLeft(userId)) === 0 ? (await this.mfa.issueBackupCodes(userId)).codes : null;
    await this.audit.log('mfa.passkey_added', { userId, meta: { passkeyId: row.id } });
    await this.mail.sendSecurityAlert(user.email, user.displayName, 'passkey_added');
    return { passkey: toDto(row), backupCodes };
  }

  async remove(userId: string, id: string, password: string): Promise<void> {
    const user = await this.requirePassword(userId, password);
    if (!(await this.passkeys.deleteOwned(userId, id))) throw new NotFoundException({ code: 'PASSKEY_NOT_FOUND', message: 'No encontramos esa llave de acceso' });
    await this.mfa.refreshEnabled(userId);
    await this.audit.log('mfa.passkey_removed', { userId, meta: { passkeyId: id } });
    await this.mail.sendSecurityAlert(user.email, user.displayName, 'passkey_removed');
  }

  /** Segundo paso del login: opciones para `navigator.credentials.get`, solo con las llaves de esta cuenta. */
  async loginOptions(user: UserRow): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const owned = await this.passkeys.listForUser(user.id);
    if (owned.length === 0) throw new ConflictException({ code: 'NO_PASSKEYS', message: 'Esta cuenta no tiene llaves de acceso' });
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials: owned.map((item) => ({ id: item.credentialId, transports: parseTransports(item.transports) })),
      userVerification: 'preferred',
    });
    await this.saveChallenge(user.id, options.challenge);
    return options;
  }

  /** Verifica la firma del dispositivo. Devuelve false ante cualquier problema (nunca detalla el motivo). */
  async verifyLogin(user: UserRow, response: WebAuthnAuthenticationInput): Promise<boolean> {
    let expectedChallenge: string;
    try {
      expectedChallenge = await this.takeChallenge(user);
    } catch {
      return false;
    }
    const passkey = await this.passkeys.findOwnedByCredentialId(user.id, response.id);
    if (!passkey) return false;
    try {
      const result = await verifyAuthenticationResponse({
        response: { ...response, clientExtensionResults: {} },
        expectedChallenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        credential: { id: passkey.credentialId, publicKey: isoBase64URL.toBuffer(passkey.publicKey), counter: passkey.counter, transports: parseTransports(passkey.transports) },
        requireUserVerification: false,
      });
      if (!result.verified) return false;
      await this.passkeys.markUsed(passkey.id, result.authenticationInfo.newCounter);
      return true;
    } catch {
      // Firma inválida, desafío vencido u otro dominio, o contador que retrocedió (posible llave clonada).
      return false;
    }
  }

  private async saveChallenge(userId: string, challenge: string): Promise<void> {
    await this.users.update(userId, {
      webauthnChallengeEncrypted: this.crypto.encryptText(challenge, challengeAad(userId)),
      webauthnChallengeExpiresAt: new Date(Date.now() + CHALLENGE_MS),
    });
  }

  /** Lee y BORRA el desafío (un solo uso). */
  private async takeChallenge(user: UserRow): Promise<string> {
    await this.users.update(user.id, { webauthnChallengeEncrypted: null, webauthnChallengeExpiresAt: null });
    if (!user.webauthnChallengeEncrypted || !user.webauthnChallengeExpiresAt || user.webauthnChallengeExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException(INVALID_PASSKEY);
    }
    return this.crypto.decryptText(user.webauthnChallengeEncrypted, challengeAad(user.id));
  }

  private async requireUser(userId: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException();
    return user;
  }

  private async requirePassword(userId: string, password: string): Promise<UserRow> {
    const user = await this.requireUser(userId);
    if (!(await this.crypto.verifyPassword(user.passwordHash, password))) throw new ForbiddenException({ code: 'INVALID_PASSWORD', message: 'La contraseña es incorrecta' });
    return user;
  }
}
