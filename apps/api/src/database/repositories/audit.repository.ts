import { Inject, Injectable } from '@nestjs/common';
import { lt } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { auditLog } from '../schema';

export interface NewAuditEntry {
  action: string;
  userId: string | null;
  ip: string | null;
  meta: Record<string, unknown> | null;
}

/** Registro de auditoría (eventos de seguridad). Única capa que escribe SQL sobre `audit_log`. */
@Injectable()
export class AuditRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async insert(entry: NewAuditEntry): Promise<void> {
    await this.db.insert(auditLog).values(entry);
  }

  /** Minimización de datos: borra los eventos anteriores a `before` (incluyen IP). Devuelve cuántos borró. */
  async deleteOlderThan(before: Date): Promise<number> {
    const removed = await this.db.delete(auditLog).where(lt(auditLog.createdAt, before)).returning({ id: auditLog.id });
    return removed.length;
  }
}
