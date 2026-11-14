import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { notBlockedBy } from './blocks.repository';
import { contacts, users, type UserRow } from '../schema';

export interface ContactWithUser {
  user: UserRow;
  alias: string | null;
  createdAt: Date;
}

@Injectable()
export class ContactsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Agenda de `ownerId`. Quien lo bloqueó no aparece (para esa persona, "no existe"); nada se borra. */
  async listWithUsers(ownerId: string): Promise<ContactWithUser[]> {
    const rows = await this.db
      .select({ user: users, alias: contacts.alias, createdAt: contacts.createdAt })
      .from(contacts)
      .innerJoin(users, eq(users.id, contacts.contactId))
      .where(and(eq(contacts.ownerId, ownerId), eq(users.status, 'active'), notBlockedBy(contacts.contactId, ownerId)))
      .orderBy(desc(contacts.createdAt));
    return rows;
  }

  async count(ownerId: string): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(contacts).where(eq(contacts.ownerId, ownerId));
    return row?.total ?? 0;
  }

  async exists(ownerId: string, contactId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ ownerId: contacts.ownerId })
      .from(contacts)
      .where(and(eq(contacts.ownerId, ownerId), eq(contacts.contactId, contactId)))
      .limit(1);
    return Boolean(row);
  }

  /** De `others`, con quiénes la agenda es MUTUA (cada uno tiene al otro). */
  async mutualAmong(userId: string, others: string[]): Promise<Set<string>> {
    if (others.length === 0) return new Set();
    const [mine, theirs] = await Promise.all([
      this.db
        .select({ id: contacts.contactId })
        .from(contacts)
        .where(and(eq(contacts.ownerId, userId), inArray(contacts.contactId, others))),
      this.db
        .select({ id: contacts.ownerId })
        .from(contacts)
        .where(and(eq(contacts.contactId, userId), inArray(contacts.ownerId, others))),
    ]);
    const added = new Set(mine.map((row) => row.id));
    return new Set(theirs.map((row) => row.id).filter((id) => added.has(id)));
  }

  async add(ownerId: string, contactId: string, alias: string | null): Promise<void> {
    await this.db
      .insert(contacts)
      .values({ ownerId, contactId, alias })
      .onConflictDoUpdate({ target: [contacts.ownerId, contacts.contactId], set: { alias } });
  }

  async remove(ownerId: string, contactId: string): Promise<boolean> {
    const rows = await this.db
      .delete(contacts)
      .where(and(eq(contacts.ownerId, ownerId), eq(contacts.contactId, contactId)))
      .returning({ ownerId: contacts.ownerId });
    return rows.length > 0;
  }
}
