import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MFA_BACKUP_CODES, type BackupCodesDto, type MfaMethod, type MfaStatusDto, type MfaVerifyInput, type TotpSetupDto } from '@qemzagram/shared';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { MfaRepository } from '../database/repositories/mfa.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { UserRow } from '../database/schema';
import { MailPort } from '../mail/mail.port';
import { formatBackupCode, generateBackupCode, generateTotpSecret, normalizeBackupCode, otpauthUrl, verifyTotp } from './totp';

const totpAad = (userId: string) => `totp:${userId}`;
const INVALID_PASSWORD = { code: 'INVALID_PASSWORD', message: 'La contraseña es incorrecta' };
const INVALID_CODE = { code: 'INVALID_CODE', message: 'El código no es válido o ya se usó' };

/**
 * Segundo factor (2FA). El secreto TOTP se guarda CIFRADO; los códigos de respaldo, solo como HMAC.
 * Activar, desactivar o regenerar exige la contraseña actual (y, para apagar, un código vigente):
 * alguien que encuentre la sesión abierta no puede desactivar la protección.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly users: UsersRepository,
    private readonly mfa: MfaRepository,
    private readonly crypto: CryptoService,
    private readonly mail: MailPort,
    private readonly audit: AuditService,
  ) {}

  async status(userId: string): Promise<MfaStatusDto> {
    const user = await this.requireUser(userId);
    return { enabled: user.mfaEnabled, totp: user.totpEnabledAt !== null, backupCodesLeft: await this.mfa.countBackupCodesLeft(userId) };
  }

  /** Métodos disponibles para el segundo paso del login. */
  async methodsFor(user: UserRow): Promise<MfaMethod[]> {
    const methods: MfaMethod[] = [];
    if (user.totpEnabledAt) methods.push('totp');
    if ((await this.mfa.countBackupCodesLeft(user.id)) > 0) methods.push('backup');
    return methods;
  }

  /** Paso 1: genera un secreto nuevo (pendiente hasta que se confirme con un código). */
  async startTotpSetup(userId: string, password: string): Promise<TotpSetupDto> {
    const user = await this.requirePassword(userId, password);
    if (user.totpEnabledAt) throw new ConflictException({ code: 'TOTP_ALREADY_ENABLED', message: 'Ya tenés activada la app autenticadora' });
    const secret = generateTotpSecret();
    await this.users.update(userId, { totpPendingEncrypted: this.crypto.encryptText(secret, totpAad(userId)) });
    return { secret, otpauthUrl: otpauthUrl(user.tag, secret) };
  }

  /** Paso 2: el primer código correcto confirma que la app quedó bien configurada. */
  async enableTotp(userId: string, code: string, now = Date.now()): Promise<BackupCodesDto> {
    const user = await this.requireUser(userId);
    if (user.totpEnabledAt) throw new ConflictException({ code: 'TOTP_ALREADY_ENABLED', message: 'Ya tenés activada la app autenticadora' });
    if (!user.totpPendingEncrypted) throw new ConflictException({ code: 'TOTP_SETUP_REQUIRED', message: 'Primero generá el código QR' });
    const secret = this.crypto.decryptText(user.totpPendingEncrypted, totpAad(userId));
    const step = verifyTotp(secret, code, now, null);
    if (step === null) throw new BadRequestException(INVALID_CODE);

    await this.users.update(userId, {
      totpSecretEncrypted: user.totpPendingEncrypted,
      totpPendingEncrypted: null,
      totpEnabledAt: new Date(now),
      totpLastStep: step,
      mfaEnabled: true,
    });
    const codes = await this.issueBackupCodes(userId);
    await this.audit.log('mfa.totp_enabled', { userId });
    await this.mail.sendSecurityAlert(user.email, user.displayName, 'mfa_enabled');
    return codes;
  }

  async disableTotp(userId: string, password: string, code: string): Promise<void> {
    const user = await this.requirePassword(userId, password);
    if (!user.totpEnabledAt) throw new ConflictException({ code: 'TOTP_NOT_ENABLED', message: 'La app autenticadora no está activada' });
    if (!(await this.verifyAnyCode(user, code))) throw new BadRequestException(INVALID_CODE);
    await this.users.update(userId, { totpSecretEncrypted: null, totpPendingEncrypted: null, totpEnabledAt: null, totpLastStep: null, mfaEnabled: false });
    await this.mfa.deleteBackupCodes(userId);
    await this.audit.log('mfa.totp_disabled', { userId });
    await this.mail.sendSecurityAlert(user.email, user.displayName, 'mfa_disabled');
  }

  async regenerateBackupCodes(userId: string, password: string, code: string): Promise<BackupCodesDto> {
    const user = await this.requirePassword(userId, password);
    if (!user.mfaEnabled) throw new ConflictException({ code: 'MFA_NOT_ENABLED', message: 'Primero activá la verificación en dos pasos' });
    if (!(await this.verifyAnyCode(user, code))) throw new BadRequestException(INVALID_CODE);
    const codes = await this.issueBackupCodes(userId);
    await this.audit.log('mfa.backup_regenerated', { userId });
    await this.mail.sendSecurityAlert(user.email, user.displayName, 'backup_codes_regenerated');
    return codes;
  }

  /** Segundo paso del login. Devuelve si el código es correcto (y lo "gasta"). */
  async verifyLoginFactor(user: UserRow, input: MfaVerifyInput, now = Date.now()): Promise<boolean> {
    if (input.method === 'totp') return this.checkTotp(user, input.code, now);
    const ok = await this.mfa.consumeBackupCode(user.id, this.crypto.hashSecret(normalizeBackupCode(input.code)));
    if (ok) {
      await this.audit.log('mfa.backup_used', { userId: user.id });
      await this.mail.sendSecurityAlert(user.email, user.displayName, 'backup_code_used');
    }
    return ok;
  }

  /** Para confirmar acciones: 6 dígitos = TOTP; si no, código de respaldo. */
  private async verifyAnyCode(user: UserRow, code: string): Promise<boolean> {
    const trimmed = code.trim();
    if (/^\d{6}$/.test(trimmed)) return this.checkTotp(user, trimmed, Date.now());
    return this.mfa.consumeBackupCode(user.id, this.crypto.hashSecret(normalizeBackupCode(trimmed)));
  }

  private async checkTotp(user: UserRow, code: string, now: number): Promise<boolean> {
    if (!user.totpSecretEncrypted) return false;
    const secret = this.crypto.decryptText(user.totpSecretEncrypted, totpAad(user.id));
    const step = verifyTotp(secret, code, now, user.totpLastStep);
    if (step === null) return false;
    return this.users.advanceTotpStep(user.id, step);
  }

  private async issueBackupCodes(userId: string): Promise<BackupCodesDto> {
    const codes = Array.from({ length: MFA_BACKUP_CODES }, generateBackupCode);
    await this.mfa.replaceBackupCodes(
      userId,
      codes.map((code) => this.crypto.hashSecret(code)),
    );
    return { codes: codes.map(formatBackupCode) };
  }

  private async requireUser(userId: string): Promise<UserRow> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException();
    return user;
  }

  private async requirePassword(userId: string, password: string): Promise<UserRow> {
    const user = await this.requireUser(userId);
    if (!(await this.crypto.verifyPassword(user.passwordHash, password))) throw new ForbiddenException(INVALID_PASSWORD);
    return user;
  }
}
