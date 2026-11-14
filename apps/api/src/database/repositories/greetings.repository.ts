import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, ne, or } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { contacts, nearbyGreetings, users, type NearbyGreetingRow, type UserRow } from '../schema';
import { noBlockBetween } from './blocks.repository';

export interface GreetingWithUser {
  greeting: NearbyGreetingRow;
  /** La OTRA persona (quien saludó, en los recibidos; a quien saludé, en los enviados). */
  user: UserRow;
}

/** Saludos de "Personas cercanas". Las listas ya excluyen vencidos, cuentas inactivas y bloqueos. */
@Injectable()
export class GreetingsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findById(id: string): Promise<NearbyGreetingRow | undefined> {
    const [row] = await this.db.select().from(nearbyGreetings).where(eq(nearbyGreetings.id, id)).limit(1);
    return row;
  }

  async findPair(fromId: string, toId: string): Promise<NearbyGreetingRow | undefined> {
    const [row] = await this.db
      .select()
      .from(nearbyGreetings)
      .where(and(eq(nearbyGreetings.fromId, fromId), eq(nearbyGreetings.toId, toId)))
      .limit(1);
    return row;
  }

  /** Crea el saludo, o lo vuelve a "pendiente" si ya existía (vencido o de una conexión anterior). */
  async upsertPending(fromId: string, toId: string, now: Date): Promise<NearbyGreetingRow> {
    const [row] = await this.db
      .insert(nearbyGreetings)
      .values({ fromId, toId, status: 'pending', createdAt: now })
      .onConflictDoUpdate({
        target: [nearbyGreetings.fromId, nearbyGreetings.toId],
        set: { status: 'pending', createdAt: now, respondedAt: null },
      })
      .returning();
    if (!row) throw new Error('No se pudo guardar el saludo');
    return row;
  }

  async countSentSince(fromId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(nearbyGreetings)
      .where(and(eq(nearbyGreetings.fromId, fromId), gt(nearbyGreetings.createdAt, since)));
    return row?.total ?? 0;
  }

  /** Saludos pendientes que recibió `userId` (sin vencer, de cuentas activas, sin bloqueo). */
  listReceived(userId: string, since: Date): Promise<GreetingWithUser[]> {
    return this.db
      .select({ greeting: nearbyGreetings, user: users })
      .from(nearbyGreetings)
      .innerJoin(users, eq(users.id, nearbyGreetings.fromId))
      .where(
        and(
          eq(nearbyGreetings.toId, userId),
          eq(nearbyGreetings.status, 'pending'),
          gt(nearbyGreetings.createdAt, since),
          eq(users.status, 'active'),
          noBlockBetween(userId, nearbyGreetings.fromId),
        ),
      )
      .orderBy(desc(nearbyGreetings.createdAt));
  }

  /**
   * Saludos que envió `userId` y siguen "en espera". Un saludo RECHAZADO se sigue mostrando como
   * enviado hasta que vence: a quien saluda nunca se le informa el rechazo.
   */
  listSent(userId: string, since: Date): Promise<GreetingWithUser[]> {
    return this.db
      .select({ greeting: nearbyGreetings, user: users })
      .from(nearbyGreetings)
      .innerJoin(users, eq(users.id, nearbyGreetings.toId))
      .where(
        and(
          eq(nearbyGreetings.fromId, userId),
          ne(nearbyGreetings.status, 'accepted'),
          gt(nearbyGreetings.createdAt, since),
          eq(users.status, 'active'),
          noBlockBetween(userId, nearbyGreetings.toId),
        ),
      )
      .orderBy(desc(nearbyGreetings.createdAt));
  }

  /** Saludos vigentes (no aceptados) entre `userId` y cada una de `others`, en cualquier dirección. */
  async listBetween(userId: string, others: string[], since: Date): Promise<NearbyGreetingRow[]> {
    if (others.length === 0) return [];
    return this.db
      .select()
      .from(nearbyGreetings)
      .where(
        and(
          ne(nearbyGreetings.status, 'accepted'),
          gt(nearbyGreetings.createdAt, since),
          or(
            and(eq(nearbyGreetings.fromId, userId), inArray(nearbyGreetings.toId, others)),
            and(eq(nearbyGreetings.toId, userId), inArray(nearbyGreetings.fromId, others)),
          ),
        ),
      );
  }

  /**
   * Acepta el saludo y agrega a las dos personas a la agenda de la otra, todo junto (transacción).
   * Solo si sigue pendiente y sin vencer; si no, devuelve undefined.
   */
  async accept(id: string, toId: string, since: Date, now: Date): Promise<NearbyGreetingRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(nearbyGreetings)
        .set({ status: 'accepted', respondedAt: now })
        .where(and(eq(nearbyGreetings.id, id), eq(nearbyGreetings.toId, toId), eq(nearbyGreetings.status, 'pending'), gt(nearbyGreetings.createdAt, since)))
        .returning();
      if (!row) return undefined;
      await tx
        .insert(contacts)
        .values([
          { ownerId: row.fromId, contactId: row.toId },
          { ownerId: row.toId, contactId: row.fromId },
        ])
        .onConflictDoNothing();
      // Si había un saludo en la dirección contraria, también queda resuelto.
      await tx
        .update(nearbyGreetings)
        .set({ status: 'accepted', respondedAt: now })
        .where(and(eq(nearbyGreetings.fromId, row.toId), eq(nearbyGreetings.toId, row.fromId)));
      return row;
    });
  }

  async decline(id: string, toId: string, since: Date, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(nearbyGreetings)
      .set({ status: 'declined', respondedAt: now })
      .where(and(eq(nearbyGreetings.id, id), eq(nearbyGreetings.toId, toId), eq(nearbyGreetings.status, 'pending'), gt(nearbyGreetings.createdAt, since)))
      .returning({ id: nearbyGreetings.id });
    return rows.length > 0;
  }

  async removeAllFor(userId: string): Promise<void> {
    await this.db.delete(nearbyGreetings).where(or(eq(nearbyGreetings.fromId, userId), eq(nearbyGreetings.toId, userId)));
  }
}
