import { Inject, Injectable } from '@nestjs/common';
import { and, between, eq, gt, isNotNull, lte, ne } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { nearbyPresence, users, type NearbyPresenceRow, type UserRow } from '../schema';
import { noBlockBetween } from './blocks.repository';

export interface NearbyCandidate {
  user: UserRow;
  row: number;
  col: number;
}

/** Tope de candidatos que se leen por búsqueda (después se filtran por distancia real entre celdas). */
const CANDIDATES_LIMIT = 1000;

@Injectable()
export class NearbyRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(userId: string): Promise<NearbyPresenceRow | undefined> {
    const [row] = await this.db.select().from(nearbyPresence).where(eq(nearbyPresence.userId, userId)).limit(1);
    return row;
  }

  async save(userId: string, values: Omit<NearbyPresenceRow, 'userId' | 'updatedAt'>): Promise<void> {
    const now = new Date();
    await this.db
      .insert(nearbyPresence)
      .values({ userId, ...values, updatedAt: now })
      .onConflictDoUpdate({ target: nearbyPresence.userId, set: { ...values, updatedAt: now } });
  }

  /** Modo invisible: se BORRA la celda (los contadores anti-rastreo se conservan). */
  async hide(userId: string): Promise<void> {
    await this.db
      .update(nearbyPresence)
      .set({ cellRow: null, cellCol: null, visibleUntil: null, updatedAt: new Date() })
      .where(eq(nearbyPresence.userId, userId));
  }

  /** Apaga (y borra la celda de) quienes ya vencieron. Devuelve cuántos. */
  async hideExpired(now: Date): Promise<number> {
    const rows = await this.db
      .update(nearbyPresence)
      .set({ cellRow: null, cellCol: null, visibleUntil: null, updatedAt: now })
      .where(and(isNotNull(nearbyPresence.cellRow), lte(nearbyPresence.visibleUntil, now)))
      .returning({ userId: nearbyPresence.userId });
    return rows.length;
  }

  /**
   * Personas visibles en un rango de filas de la grilla (el filtro fino por distancia lo hace el servicio).
   * La regla de privacidad va DENTRO de la consulta: activas, visibles, sin vencer y sin bloqueo con quien busca.
   */
  async listCandidates(viewerId: string, rowMin: number, rowMax: number, now: Date): Promise<NearbyCandidate[]> {
    const rows = await this.db
      .select({ user: users, row: nearbyPresence.cellRow, col: nearbyPresence.cellCol })
      .from(nearbyPresence)
      .innerJoin(users, eq(users.id, nearbyPresence.userId))
      .where(
        and(
          ne(nearbyPresence.userId, viewerId),
          isNotNull(nearbyPresence.cellCol),
          between(nearbyPresence.cellRow, rowMin, rowMax),
          gt(nearbyPresence.visibleUntil, now),
          eq(users.status, 'active'),
          noBlockBetween(viewerId, nearbyPresence.userId),
        ),
      )
      .limit(CANDIDATES_LIMIT);
    return rows.flatMap((row) => (row.row === null || row.col === null ? [] : [{ user: row.user, row: row.row, col: row.col }]));
  }

  /** `targetId` si hoy es visible para `viewerId` (mismas reglas que la búsqueda); si no, undefined. */
  async findCandidate(viewerId: string, targetId: string, now: Date): Promise<NearbyCandidate | undefined> {
    const [row] = await this.db
      .select({ user: users, row: nearbyPresence.cellRow, col: nearbyPresence.cellCol })
      .from(nearbyPresence)
      .innerJoin(users, eq(users.id, nearbyPresence.userId))
      .where(
        and(
          eq(nearbyPresence.userId, targetId),
          ne(nearbyPresence.userId, viewerId),
          gt(nearbyPresence.visibleUntil, now),
          eq(users.status, 'active'),
          noBlockBetween(viewerId, nearbyPresence.userId),
        ),
      )
      .limit(1);
    return row && row.row !== null && row.col !== null ? { user: row.user, row: row.row, col: row.col } : undefined;
  }

  async remove(userId: string): Promise<void> {
    await this.db.delete(nearbyPresence).where(eq(nearbyPresence.userId, userId));
  }
}
