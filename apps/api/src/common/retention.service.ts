import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AUDIT_LOG_RETENTION_DAYS } from '@qemzagram/shared';
import { AuditRepository } from '../database/repositories/audit.repository';
import { SessionsRepository } from '../database/repositories/sessions.repository';

const EVERY_6_HOURS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  auditEntries: number;
  sessions: number;
}

/**
 * Minimización de datos (Ley 25.326, art. 4): borra lo que ya no hace falta y tiene datos personales.
 * - Registro de auditoría (con IP) de más de AUDIT_LOG_RETENTION_DAYS días.
 * - Sesiones vencidas (con IP y navegador). Ver SessionsRepository.deleteExpiredBefore.
 * Lo que dice la Política de Privacidad sobre plazos depende de esto: si cambiás un plazo, actualizala.
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly audit: AuditRepository,
    private readonly sessions: SessionsRepository,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run(), EVERY_6_HOURS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<RetentionResult> {
    const result: RetentionResult = { auditEntries: 0, sessions: 0 };
    try {
      result.auditEntries = await this.audit.deleteOlderThan(new Date(now.getTime() - AUDIT_LOG_RETENTION_DAYS * DAY_MS));
      result.sessions = await this.sessions.deleteExpiredBefore(now);
      if (result.auditEntries + result.sessions > 0) {
        this.logger.log(`Retención: ${result.auditEntries} eventos de auditoría y ${result.sessions} sesiones vencidas borrados`);
      }
    } catch (error) {
      this.logger.error(`Falló la limpieza por retención: ${(error as Error).message}`);
    }
    return result;
  }
}
