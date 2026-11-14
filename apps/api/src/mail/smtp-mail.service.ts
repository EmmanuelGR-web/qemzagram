import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { ENV, type AppEnv } from '../config/env';
import { MailPort, type SecurityEvent } from './mail.port';
import {
  accountExistsEmail,
  passwordChangedEmail,
  accountBannedEmail,
  appealResultEmail,
  securityAlertEmail,
  passwordResetEmail,
  verificationEmail,
  type EmailContent,
} from './mail.templates';

@Injectable()
export class SmtpMailService extends MailPort {
  private readonly logger = new Logger(SmtpMailService.name);
  private readonly transporter: Transporter | null;

  constructor(@Inject(ENV) private readonly env: AppEnv) {
    super();
    this.transporter = env.SMTP_HOST
      ? createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE === 'true',
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        })
      : null;
  }

  sendVerification(to: string, displayName: string, token: string): Promise<void> {
    const url = `${this.env.WEB_ORIGIN}/verificar?token=${encodeURIComponent(token)}`;
    return this.deliver(to, verificationEmail(displayName, url), url);
  }

  sendAccountAlreadyExists(to: string): Promise<void> {
    return this.deliver(to, accountExistsEmail());
  }

  sendPasswordReset(to: string, displayName: string, token: string): Promise<void> {
    const url = `${this.env.WEB_ORIGIN}/restablecer?token=${encodeURIComponent(token)}`;
    return this.deliver(to, passwordResetEmail(displayName, url), url);
  }

  sendPasswordChanged(to: string, displayName: string): Promise<void> {
    return this.deliver(to, passwordChangedEmail(displayName));
  }

  sendAccountBanned(to: string, displayName: string): Promise<void> {
    return this.deliver(to, accountBannedEmail(displayName, `${this.env.WEB_ORIGIN}/apelar`));
  }

  sendAppealResult(to: string, displayName: string, accepted: boolean): Promise<void> {
    return this.deliver(to, appealResultEmail(displayName, accepted, `${this.env.WEB_ORIGIN}/login`));
  }

  sendSecurityAlert(to: string, displayName: string, event: SecurityEvent): Promise<void> {
    return this.deliver(to, securityAlertEmail(displayName, event));
  }

  private async deliver(to: string, content: EmailContent, devLink?: string): Promise<void> {
    if (!this.transporter) {
      // Sin SMTP configurado (desarrollo): el enlace se imprime en la consola del servidor.
      if (this.env.NODE_ENV === 'production') {
        this.logger.error('SMTP_HOST no está configurado: no se puede enviar correo en producción.');
        return;
      }
      this.logger.warn(`[CORREO SIMULADO] Para: ${maskEmail(to)} | Asunto: ${content.subject}${devLink ? ` | Enlace: ${devLink}` : ''}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.env.MAIL_FROM, to, subject: content.subject, text: content.text, html: content.html });
    } catch (error) {
      // No se propaga: evita revelar por timing/errores si un correo existe. Queda en el log del servidor.
      this.logger.error(`Fallo al enviar correo a ${maskEmail(to)}: ${(error as Error).message}`);
    }
  }
}

/** Enmascara un correo para los logs: `juan@gmail.com` → `j***@gmail.com`. */
export function maskEmail(email: string): string {
  return email.replace(/^(.).*(@.+)$/, '$1***$2');
}
