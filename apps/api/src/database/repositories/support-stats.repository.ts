import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, gte } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { appeals, auditLog, calls, conversations, messages, nearbyPresence, reports, statuses, users } from '../schema';

/**
 * Estadísticas para el panel de soporte. SOLO conteos agregados: ninguna consulta devuelve
 * filas de personas, mensajes ni conversaciones concretas.
 */
@Injectable()
export class SupportStatsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async usersByStatus(): Promise<Map<string, number>> {
    const rows = await this.db.select({ status: users.status, total: count() }).from(users).groupBy(users.status);
    return new Map(rows.map((row) => [row.status, row.total]));
  }

  async usersCreatedSince(since: Date): Promise<number> {
    return this.total(this.db.select({ total: count() }).from(users).where(gte(users.createdAt, since)));
  }

  async messagesSince(since: Date): Promise<number> {
    return this.total(this.db.select({ total: count() }).from(messages).where(gte(messages.createdAt, since)));
  }

  async conversationsByType(): Promise<Map<string, number>> {
    const rows = await this.db.select({ type: conversations.type, total: count() }).from(conversations).groupBy(conversations.type);
    return new Map(rows.map((row) => [row.type, row.total]));
  }

  async activeStatuses(now: Date): Promise<number> {
    return this.total(this.db.select({ total: count() }).from(statuses).where(gt(statuses.expiresAt, now)));
  }

  async callsSince(since: Date): Promise<number> {
    return this.total(this.db.select({ total: count() }).from(calls).where(gte(calls.createdAt, since)));
  }

  async nearbyVisible(now: Date): Promise<number> {
    return this.total(this.db.select({ total: count() }).from(nearbyPresence).where(gt(nearbyPresence.visibleUntil, now)));
  }

  async reportsByStatus(): Promise<Map<string, number>> {
    const rows = await this.db.select({ status: reports.status, total: count() }).from(reports).groupBy(reports.status);
    return new Map(rows.map((row) => [row.status, row.total]));
  }

  async pendingAppeals(): Promise<number> {
    return this.total(this.db.select({ total: count() }).from(appeals).where(eq(appeals.status, 'pending')));
  }

  async auditEventsSince(action: string, since: Date): Promise<number> {
    return this.total(this.db.select({ total: count() }).from(auditLog).where(and(eq(auditLog.action, action), gte(auditLog.createdAt, since))));
  }

  private async total(query: Promise<{ total: number }[]>): Promise<number> {
    const [row] = await query;
    return row?.total ?? 0;
  }
}
