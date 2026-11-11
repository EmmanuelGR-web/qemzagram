/**
 * Puerto de correo (inversión de dependencias): el resto de la app depende de esta
 * abstracción, no de nodemailer. En tests se reemplaza por una implementación falsa.
 */
export abstract class MailPort {
  abstract sendVerification(to: string, displayName: string, token: string): Promise<void>;
  abstract sendAccountAlreadyExists(to: string): Promise<void>;
  abstract sendPasswordReset(to: string, displayName: string, token: string): Promise<void>;
  abstract sendPasswordChanged(to: string, displayName: string): Promise<void>;
}
