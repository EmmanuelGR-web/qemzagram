import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { pushSubscriptions, type PushSubscriptionRow } from '../schema';

@Injectable()
export class PushSubscriptionsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Guarda (o reasigna) la suscripción de un dispositivo. Si el mismo navegador se suscribe
   * con otra cuenta, pasa a ser de esa cuenta: un dispositivo no recibe avisos de dos personas.
   */
  async upsert(userId: string, endpointHash: string, dataEncrypted: string): Promise<void> {
    await this.db
      .insert(pushSubscriptions)
      .values({ userId, endpointHash, dataEncrypted })
      .onConflictDoUpdate({ target: pushSubscriptions.endpointHash, set: { userId, dataEncrypted, createdAt: new Date() } });
  }

  /** Deja solo las `keep` suscripciones más nuevas de una persona. */
  async trimForUser(userId: string, keep: number): Promise<void> {
    const newest = await this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
      .orderBy(desc(pushSubscriptions.createdAt))
      .limit(keep);
    if (newest.length < keep) return;
    await this.db.delete(pushSubscriptions).where(
      and(
        eq(pushSubscriptions.userId, userId),
        notInArray(
          pushSubscriptions.id,
          newest.map((row) => row.id),
        ),
      ),
    );
  }

  async listForUsers(userIds: string[]): Promise<PushSubscriptionRow[]> {
    if (userIds.length === 0) return [];
    return this.db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  }

  /** Borra una suscripción SOLO si es de esa persona. */
  async deleteOwned(userId: string, endpointHash: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpointHash, endpointHash)));
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }
}
