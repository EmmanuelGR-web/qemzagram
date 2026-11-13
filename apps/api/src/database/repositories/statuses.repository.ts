import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, exists, gt, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../database.types';
import { contacts, statuses, users, type NewStatusRow, type StatusRow, type UserRow } from '../schema';

export interface StatusWithOwner {
  status: StatusRow;
  owner: UserRow;
}

/** Cuántos estados vencidos se borran por vuelta de limpieza (evita transacciones enormes). */
const PURGE_BATCH = 200;

/**
 * Única capa que consulta los estados. La regla de visibilidad vive en `visibleTo`
 * y se aplica DENTRO de cada consulta: no se trae nada que después haya que filtrar.
 */
@Injectable()
export class StatusesRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(values: NewStatusRow): Promise<StatusRow> {
    const [row] = await this.db.insert(statuses).values(values).returning();
    if (!row) throw new Error('No se pudo guardar el estado');
    return row;
  }

  async countActive(ownerId: string, now: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(statuses)
      .where(and(eq(statuses.ownerId, ownerId), gt(statuses.expiresAt, now)));
    return row?.total ?? 0;
  }

  listActiveByOwner(ownerId: string, now: Date): Promise<StatusRow[]> {
    return this.db
      .select()
      .from(statuses)
      .where(and(eq(statuses.ownerId, ownerId), gt(statuses.expiresAt, now)))
      .orderBy(asc(statuses.createdAt));
  }

  /** Estados vigentes de OTRAS personas que `viewerId` tiene permitido ver (más viejos primero). */
  listFeed(viewerId: string, now: Date): Promise<StatusWithOwner[]> {
    return this.db
      .select({ status: statuses, owner: users })
      .from(statuses)
      .innerJoin(users, eq(users.id, statuses.ownerId))
      .where(and(gt(statuses.expiresAt, now), ne(statuses.ownerId, viewerId), this.visibleTo(viewerId)))
      .orderBy(asc(statuses.createdAt));
  }

  /** Un estado vigente SOLO si es propio o si `viewerId` tiene permiso para verlo. */
  async findVisible(id: string, viewerId: string, now: Date): Promise<StatusRow | undefined> {
    const [row] = await this.db
      .select({ status: statuses })
      .from(statuses)
      .innerJoin(users, eq(users.id, statuses.ownerId))
      .where(
        and(
          eq(statuses.id, id),
          gt(statuses.expiresAt, now),
          sql`(${eq(statuses.ownerId, viewerId)} OR ${this.visibleTo(viewerId)})`,
        ),
      )
      .limit(1);
    return row?.status;
  }

  /**
   * Personas que pueden ver los estados de `ownerId` (para avisarles en tiempo real).
   * Misma regla que `visibleTo`, vista desde el lado del dueño.
   */
  async listAudienceIds(ownerId: string): Promise<string[]> {
    const back = alias(contacts, 'back');
    const rows = await this.db
      .select({ id: users.id })
      .from(contacts)
      .innerJoin(users, eq(users.id, contacts.contactId))
      .innerJoin(back, and(eq(back.ownerId, contacts.contactId), eq(back.contactId, ownerId)))
      .where(and(eq(contacts.ownerId, ownerId), eq(users.status, 'active')));
    return rows.map((row) => row.id);
  }

  /** Borra un estado propio y devuelve su clave de almacenamiento (`null` si no tenía archivo). */
  async deleteOwned(id: string, ownerId: string): Promise<{ storageKey: string | null } | undefined> {
    const [row] = await this.db
      .delete(statuses)
      .where(and(eq(statuses.id, id), eq(statuses.ownerId, ownerId)))
      .returning({ storageKey: statuses.storageKey });
    return row;
  }

  /** Borra un lote de estados vencidos y devuelve las claves de sus archivos para borrarlos también. */
  async deleteExpired(now: Date): Promise<{ deleted: number; storageKeys: string[] }> {
    const expired = await this.db
      .select({ id: statuses.id })
      .from(statuses)
      .where(lte(statuses.expiresAt, now))
      .limit(PURGE_BATCH);
    if (expired.length === 0) return { deleted: 0, storageKeys: [] };
    const rows = await this.db
      .delete(statuses)
      .where(
        inArray(
          statuses.id,
          expired.map((row) => row.id),
        ),
      )
      .returning({ storageKey: statuses.storageKey });
    return { deleted: rows.length, storageKeys: rows.flatMap((row) => (row.storageKey ? [row.storageKey] : [])) };
  }

  /** Borra TODOS los estados de una persona (baja de cuenta). */
  async deleteAllForOwner(ownerId: string): Promise<string[]> {
    const rows = await this.db.delete(statuses).where(eq(statuses.ownerId, ownerId)).returning({ storageKey: statuses.storageKey });
    return rows.flatMap((row) => (row.storageKey ? [row.storageKey] : []));
  }

  /**
   * Regla de visibilidad: el dueño está activo, se agregaron MUTUAMENTE a la agenda
   * (el dueño eligió a quien mira y quien mira sigue al dueño).
   */
  private visibleTo(viewerId: string): SQL {
    const ownerAddedViewer = this.db
      .select({ one: sql`1` })
      .from(contacts)
      .where(and(eq(contacts.ownerId, statuses.ownerId), eq(contacts.contactId, viewerId)));
    const viewerAddedOwner = this.db
      .select({ one: sql`1` })
      .from(contacts)
      .where(and(eq(contacts.ownerId, viewerId), eq(contacts.contactId, statuses.ownerId)));
    const condition = and(eq(users.status, 'active'), exists(ownerAddedViewer), exists(viewerAddedOwner));
    if (!condition) throw new Error('Condición de visibilidad vacía');
    return condition;
  }
}
