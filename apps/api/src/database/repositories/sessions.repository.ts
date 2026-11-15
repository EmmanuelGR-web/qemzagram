import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { sessions, type SessionRow } from '../schema';

export interface NewSession {
  userId: string;
  refreshHash: string;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
}

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(values: NewSession): Promise<SessionRow> {
    const [row] = await this.db.insert(sessions).values(values).returning();
    if (!row) throw new Error('No se pudo crear la sesión');
    return row;
  }

  async findByHash(refreshHash: string): Promise<SessionRow | undefined> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.refreshHash, refreshHash)).limit(1);
    return row;
  }

  /** Revoca la sesión vieja y crea la nueva de forma atómica (rotación del refresh token). */
  async rotate(oldId: string, next: NewSession): Promise<SessionRow> {
    return this.db.transaction(async (tx) => {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, oldId));
      const [row] = await tx.insert(sessions).values(next).returning();
      if (!row) throw new Error('No se pudo rotar la sesión');
      return row;
    });
  }

  async revoke(id: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
  }

  /**
   * Minimización de datos: borra las sesiones VENCIDAS antes de `before` (tienen IP y navegador).
   * Las revocadas pero todavía vigentes se conservan a propósito: sirven para detectar la
   * reutilización de un refresh token robado. Un token vencido se rechaza igual, así que borrarlo es seguro.
   */
  async deleteExpiredBefore(before: Date): Promise<number> {
    const removed = await this.db.delete(sessions).where(lt(sessions.expiresAt, before)).returning({ id: sessions.id });
    return removed.length;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }
}
