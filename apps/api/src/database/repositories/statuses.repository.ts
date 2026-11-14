import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, exists, gt, inArray, lte, ne, not, or, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { DB, type Database } from '../database.types';
import { noBlockBetween } from './blocks.repository';
import { contacts, statusAudienceMembers, statuses, statusViews, users, type NewStatusRow, type StatusRow, type UserRow } from '../schema';

export interface StatusWithOwner {
  status: StatusRow;
  owner: UserRow;
}

export type StatusAudience = UserRow['statusAudience'];
type AudienceList = (typeof statusAudienceMembers.$inferSelect)['list'];

export interface StatusPrivacyRows {
  audience: StatusAudience;
  except: UserRow[];
  only: UserRow[];
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

  /** Un estado vigente SOLO si pertenece a `ownerId`. */
  async findOwnedActive(id: string, ownerId: string, now: Date): Promise<StatusRow | undefined> {
    const [row] = await this.db
      .select()
      .from(statuses)
      .where(and(eq(statuses.id, id), eq(statuses.ownerId, ownerId), gt(statuses.expiresAt, now)))
      .limit(1);
    return row;
  }

  /** Registra que alguien vio un estado (una sola vez por persona; las repeticiones se ignoran). */
  async markViewed(statusId: string, viewerId: string): Promise<void> {
    await this.db.insert(statusViews).values({ statusId, viewerId }).onConflictDoNothing();
  }

  /** De esta lista de estados, cuáles ya vio `viewerId`. */
  async viewedIds(viewerId: string, statusIds: string[]): Promise<Set<string>> {
    if (statusIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: statusViews.statusId })
      .from(statusViews)
      .where(and(eq(statusViews.viewerId, viewerId), inArray(statusViews.statusId, statusIds)));
    return new Set(rows.map((row) => row.id));
  }

  /** Cantidad de vistas por estado (solo cuentan cuentas activas). */
  async viewCounts(statusIds: string[]): Promise<Map<string, number>> {
    if (statusIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: statusViews.statusId, total: count() })
      .from(statusViews)
      .innerJoin(users, eq(users.id, statusViews.viewerId))
      .where(and(inArray(statusViews.statusId, statusIds), eq(users.status, 'active')))
      .groupBy(statusViews.statusId);
    return new Map(rows.map((row) => [row.id, row.total]));
  }

  /** Quién vio un estado, del más reciente al más viejo (solo cuentas activas). */
  listViews(statusId: string): Promise<{ user: UserRow; viewedAt: Date }[]> {
    return this.db
      .select({ user: users, viewedAt: statusViews.viewedAt })
      .from(statusViews)
      .innerJoin(users, eq(users.id, statusViews.viewerId))
      .where(and(eq(statusViews.statusId, statusId), eq(users.status, 'active')))
      .orderBy(desc(statusViews.viewedAt));
  }

  /**
   * Personas que pueden ver los estados de `ownerId` (para avisarles en tiempo real).
   * Misma regla que `visibleTo`, vista desde el lado del dueño.
   */
  async listAudienceIds(ownerId: string): Promise<string[]> {
    const owner = await this.db.select({ audience: users.statusAudience }).from(users).where(eq(users.id, ownerId)).limit(1);
    const audience = owner[0]?.audience;
    if (!audience) return [];
    const back = alias(contacts, 'back');
    const rows = await this.db
      .select({ id: users.id })
      .from(contacts)
      .innerJoin(users, eq(users.id, contacts.contactId))
      .innerJoin(back, and(eq(back.ownerId, contacts.contactId), eq(back.contactId, ownerId)))
      .where(and(eq(contacts.ownerId, ownerId), eq(users.status, 'active'), this.audienceAllows(audience, sql`${ownerId}`, contacts.contactId)));
    return rows.map((row) => row.id);
  }

  /** Opción de privacidad + las dos listas, solo con personas que siguen en la agenda y activas. */
  async getPrivacy(ownerId: string): Promise<StatusPrivacyRows> {
    const [owner] = await this.db.select({ audience: users.statusAudience }).from(users).where(eq(users.id, ownerId)).limit(1);
    const members = await this.db
      .select({ list: statusAudienceMembers.list, user: users })
      .from(statusAudienceMembers)
      .innerJoin(users, eq(users.id, statusAudienceMembers.memberId))
      .innerJoin(contacts, and(eq(contacts.ownerId, ownerId), eq(contacts.contactId, statusAudienceMembers.memberId)))
      .where(and(eq(statusAudienceMembers.ownerId, ownerId), eq(users.status, 'active')))
      .orderBy(asc(users.displayName));
    return {
      audience: owner?.audience ?? 'contacts',
      except: members.filter((row) => row.list === 'except').map((row) => row.user),
      only: members.filter((row) => row.list === 'only').map((row) => row.user),
    };
  }

  /** Reemplaza la opción y las dos listas en una sola transacción. */
  async setPrivacy(ownerId: string, audience: StatusAudience, lists: Record<AudienceList, string[]>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ statusAudience: audience, updatedAt: new Date() }).where(eq(users.id, ownerId));
      await tx.delete(statusAudienceMembers).where(eq(statusAudienceMembers.ownerId, ownerId));
      const rows = (Object.entries(lists) as [AudienceList, string[]][]).flatMap(([list, ids]) => ids.map((memberId) => ({ ownerId, list, memberId })));
      if (rows.length > 0) await tx.insert(statusAudienceMembers).values(rows);
    });
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
   * Regla de visibilidad (consultas que unen `statuses` con su dueño en `users`):
   *  1. el dueño está activo;
   *  2. se agregaron MUTUAMENTE a la agenda;
   *  3. la privacidad del dueño lo permite: toda la agenda / la agenda menos la lista "excepto" /
   *     solo la lista "solo con". Se evalúa con la configuración ACTUAL: un cambio rige al instante.
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
    const audience = or(
      eq(users.statusAudience, 'contacts'),
      and(eq(users.statusAudience, 'except'), not(exists(this.inList('except', statuses.ownerId, sql`${viewerId}`)))),
      and(eq(users.statusAudience, 'only'), exists(this.inList('only', statuses.ownerId, sql`${viewerId}`))),
    );
    const condition = and(eq(users.status, 'active'), exists(ownerAddedViewer), exists(viewerAddedOwner), noBlockBetween(viewerId, statuses.ownerId), audience);
    if (!condition) throw new Error('Condición de visibilidad vacía');
    return condition;
  }

  /** La misma regla de privacidad, cuando ya se conoce la opción del dueño. */
  private audienceAllows(audience: StatusAudience, ownerId: SQL | AnyPgColumn, viewerId: SQL | AnyPgColumn): SQL {
    if (audience === 'contacts') return sql`true`;
    const listed = exists(this.inList(audience, ownerId, viewerId));
    return audience === 'only' ? listed : not(listed);
  }

  private inList(list: AudienceList, ownerId: SQL | AnyPgColumn, memberId: SQL | AnyPgColumn) {
    return this.db
      .select({ one: sql`1` })
      .from(statusAudienceMembers)
      .where(and(eq(statusAudienceMembers.ownerId, ownerId), eq(statusAudienceMembers.list, list), eq(statusAudienceMembers.memberId, memberId)));
  }
}
