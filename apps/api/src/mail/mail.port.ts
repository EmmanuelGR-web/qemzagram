/** Cambios de seguridad que se avisan por correo (lista cerrada). */
export type SecurityEvent = 'mfa_enabled' | 'mfa_disabled' | 'backup_codes_regenerated' | 'backup_code_used' | 'passkey_added' | 'passkey_removed' | 'e2ee_key_reset';

/**
 * Puerto de correo (inversión de dependencias): el resto de la app depende de esta
 * abstracción, no de nodemailer. En tests se reemplaza por una implementación falsa.
 */
export abstract class MailPort {
  abstract sendVerification(to: string, displayName: string, token: string): Promise<void>;
  abstract sendAccountAlreadyExists(to: string): Promise<void>;
  abstract sendPasswordReset(to: string, displayName: string, token: string): Promise<void>;
  abstract sendPasswordChanged(to: string, displayName: string): Promise<void>;
  /** Aviso de baja por incumplir las normas, con cómo apelar. */
  abstract sendAccountBanned(to: string, displayName: string): Promise<void>;
  abstract sendAppealResult(to: string, displayName: string, accepted: boolean): Promise<void>;
  /** Aviso de un cambio de seguridad en la cuenta (2FA, llaves de acceso). */
  abstract sendSecurityAlert(to: string, displayName: string, event: SecurityEvent): Promise<void>;
}
