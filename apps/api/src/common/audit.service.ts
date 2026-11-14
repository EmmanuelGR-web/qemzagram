import { Inject, Injectable, Logger } from '@nestjs/common';
import { DB, type Database } from '../database/database.types';
import { auditLog } from '../database/schema';

export type AuditAction =
  | 'register'
  | 'register.email_exists'
  | 'email.verified'
  | 'login.success'
  | 'login.failed'
  | 'login.locked'
  | 'logout'
  | 'session.reuse_detected'
  | 'password.reset_requested'
  | 'password.reset_done'
  | 'account.paused'
  | 'account.deleted'
  | 'profile.updated'
  | 'upload.malware_blocked'
  | 'user.blocked'
  | 'user.unblocked'
  | 'nearby.enabled'
  | 'nearby.disabled'
  | 'report.created'
  | 'report.confirmed'
  | 'report.dismissed'
  | 'user.banned'
  | 'user.unbanned'
  | 'appeal.created'
  | 'appeal.accepted'
  | 'appeal.rejected'
  | 'support.report_viewed'
  | 'support.user_lookup'
  | 'support.password_reset'
  | 'support.role_granted'
  | 'support.role_revoked';

/** Registra eventos de seguridad. Nunca guarda contraseñas, tokens ni contenido de mensajes. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  async log(
    action: AuditAction,
    context: { userId?: string | null; ip?: string | null; meta?: Record<string, unknown> } = {},
  ): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        action,
        userId: context.userId ?? null,
        ip: context.ip ?? null,
        meta: context.meta ?? null,
      });
    } catch (error) {
      // Un fallo de auditoría no debe romper la operación del usuario, pero sí quedar registrado.
      this.logger.error(`No se pudo registrar el evento ${action}: ${(error as Error).message}`);
    }
  }
}
