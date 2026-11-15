import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../database.types';
import { conversationMembers, e2eeKeys, messages, type E2eeKeyRow } from '../schema';

type NewKey = Pick<E2eeKeyRow, 'userId' | 'publicKey'> & { backup: NonNullable<E2eeKeyRow['backup']> };

@Injectable()
export class E2eeKeysRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findActive(userId: string): Promise<E2eeKeyRow | undefined> {
    const [row] = await this.db
      .select()
      .from(e2eeKeys)
      .where(and(eq(e2eeKeys.userId, userId), isNull(e2eeKeys.revokedAt)))
      .limit(1);
    return row;
  }

  async findManyByIds(ids: string[]): Promise<E2eeKeyRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(e2eeKeys).where(inArray(e2eeKeys.id, ids));
  }

  async activeForUsers(userIds: string[]): Promise<E2eeKeyRow[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select()
      .from(e2eeKeys)
      .where(and(inArray(e2eeKeys.userId, userIds), isNull(e2eeKeys.revokedAt)));
  }

  /** Primera clave de la cuenta. Si ya hay una activa, el índice único lo impide (devuelve undefined). */
  async createFirst(values: NewKey): Promise<E2eeKeyRow | undefined> {
    const [row] = await this.db.insert(e2eeKeys).values(values).onConflictDoNothing().returning();
    return row;
  }

  /** Revoca la clave activa (y borra su copia) y crea la nueva, todo en una transacción. */
  async replace(values: NewKey, now = new Date()): Promise<E2eeKeyRow> {
    return this.db.transaction(async (tx) => {
      await tx
        .update(e2eeKeys)
        .set({ revokedAt: now, backup: null })
        .where(and(eq(e2eeKeys.userId, values.userId), isNull(e2eeKeys.revokedAt)));
      const [row] = await tx.insert(e2eeKeys).values(values).returning();
      if (!row) throw new Error('No se pudo guardar la clave');
      return row;
    });
  }

  /** Baja de la cuenta: nadie más puede cifrarle mensajes y se borran las copias de seguridad. */
  async revokeAllForUser(userId: string, now = new Date()): Promise<void> {
    await this.db.update(e2eeKeys).set({ revokedAt: now, backup: null }).where(and(eq(e2eeKeys.userId, userId), isNull(e2eeKeys.revokedAt)));
    await this.db.update(e2eeKeys).set({ backup: null }).where(eq(e2eeKeys.userId, userId));
  }

  /**
   * De `ownerIds`, quiénes "conoce" `viewerId`: comparten hoy una conversación o escribieron alguna vez
   * en una conversación de la que `viewerId` es miembro (para verificar mensajes de ex miembros).
   */
  async ownersVisibleTo(viewerId: string, ownerIds: string[]): Promise<Set<string>> {
    if (ownerIds.length === 0) return new Set();
    const mine = alias(conversationMembers, 'mine');
    const [sharing, senders] = await Promise.all([
      this.db
        .selectDistinct({ id: conversationMembers.userId })
        .from(conversationMembers)
        .innerJoin(mine, eq(mine.conversationId, conversationMembers.conversationId))
        .where(and(eq(mine.userId, viewerId), inArray(conversationMembers.userId, ownerIds))),
      this.db
        .selectDistinct({ id: messages.senderId })
        .from(messages)
        .innerJoin(mine, eq(mine.conversationId, messages.conversationId))
        .where(and(eq(mine.userId, viewerId), inArray(messages.senderId, ownerIds))),
    ]);
    return new Set([...sharing, ...senders].map((row) => row.id));
  }
}
