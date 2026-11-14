import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../database.types';
import { userBlocks, users, type UserRow } from '../schema';

export interface BlockedWithUser {
  user: UserRow;
  createdAt: Date;
}

/**
 * Condición SQL: "NO hay bloqueo entre `userId` y la persona de la columna `other`" (en ninguna dirección).
 * Se usa DENTRO de otras consultas (estados, agenda, cercanos) para no traer nada que haya que filtrar después.
 */
export function noBlockBetween(userId: string, other: AnyPgColumn): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${userBlocks}
    WHERE (${userBlocks.blockerId} = ${userId} AND ${userBlocks.blockedId} = ${other})
       OR (${userBlocks.blockerId} = ${other} AND ${userBlocks.blockedId} = ${userId})
  )`;
}

/** Condición SQL: "la persona de la columna `other` NO bloqueó a `userId`". */
export function notBlockedBy(other: AnyPgColumn, userId: string): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM ${userBlocks} WHERE ${userBlocks.blockerId} = ${other} AND ${userBlocks.blockedId} = ${userId}
  )`;
}

@Injectable()
export class BlocksRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async block(blockerId: string, blockedId: string): Promise<void> {
    await this.db.insert(userBlocks).values({ blockerId, blockedId }).onConflictDoNothing();
  }

  async unblock(blockerId: string, blockedId: string): Promise<boolean> {
    const rows = await this.db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), eq(userBlocks.blockedId, blockedId)))
      .returning({ blockerId: userBlocks.blockerId });
    return rows.length > 0;
  }

  async count(blockerId: string): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(userBlocks).where(eq(userBlocks.blockerId, blockerId));
    return row?.total ?? 0;
  }

  /** Personas que `blockerId` bloqueó (más recientes primero). */
  listWithUsers(blockerId: string): Promise<BlockedWithUser[]> {
    return this.db
      .select({ user: users, createdAt: userBlocks.createdAt })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(eq(userBlocks.blockerId, blockerId))
      .orderBy(desc(userBlocks.createdAt));
  }

  /** De `others`, a quiénes bloqueó `blockerId`. */
  async blockedAmong(blockerId: string, others: string[]): Promise<Set<string>> {
    if (others.length === 0) return new Set();
    const rows = await this.db
      .select({ id: userBlocks.blockedId })
      .from(userBlocks)
      .where(and(eq(userBlocks.blockerId, blockerId), inArray(userBlocks.blockedId, others)));
    return new Set(rows.map((row) => row.id));
  }

  /** De `others`, quiénes bloquearon a `userId`. */
  async blockersAmong(userId: string, others: string[]): Promise<Set<string>> {
    if (others.length === 0) return new Set();
    const rows = await this.db
      .select({ id: userBlocks.blockerId })
      .from(userBlocks)
      .where(and(eq(userBlocks.blockedId, userId), inArray(userBlocks.blockerId, others)));
    return new Set(rows.map((row) => row.id));
  }

  /** De `others`, con quiénes hay un bloqueo con `userId` (en cualquier dirección). */
  async blockedEitherAmong(userId: string, others: string[]): Promise<Set<string>> {
    if (others.length === 0) return new Set();
    const rows = await this.db
      .select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId })
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.blockerId, userId), inArray(userBlocks.blockedId, others)),
          and(eq(userBlocks.blockedId, userId), inArray(userBlocks.blockerId, others)),
        ),
      );
    return new Set(rows.map((row) => (row.blockerId === userId ? row.blockedId : row.blockerId)));
  }

  /** Al dar de baja una cuenta: se borran sus bloqueos en las dos direcciones. */
  async removeAllFor(userId: string): Promise<void> {
    await this.db.delete(userBlocks).where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
  }
}
