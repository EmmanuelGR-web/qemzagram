import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { appeals, users, type AppealRow, type UserRow } from '../schema';

export interface AppealWithUser {
  appeal: AppealRow;
  user: UserRow;
}

@Injectable()
export class AppealsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(values: Pick<AppealRow, 'id' | 'userId' | 'messageEncrypted'>): Promise<AppealRow> {
    const [row] = await this.db.insert(appeals).values(values).returning();
    if (!row) throw new Error('No se pudo guardar la apelación');
    return row;
  }

  async hasPending(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: appeals.id })
      .from(appeals)
      .where(and(eq(appeals.userId, userId), eq(appeals.status, 'pending')))
      .limit(1);
    return Boolean(row);
  }

  async lastRejectedAt(userId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ reviewedAt: appeals.reviewedAt })
      .from(appeals)
      .where(and(eq(appeals.userId, userId), eq(appeals.status, 'rejected')))
      .orderBy(desc(appeals.reviewedAt))
      .limit(1);
    return row?.reviewedAt ?? null;
  }

  async list(status: AppealRow['status'], limit = 100): Promise<AppealWithUser[]> {
    return this.db
      .select({ appeal: appeals, user: users })
      .from(appeals)
      .innerJoin(users, eq(users.id, appeals.userId))
      .where(eq(appeals.status, status))
      .orderBy(status === 'pending' ? appeals.createdAt : desc(appeals.reviewedAt))
      .limit(limit);
  }

  async findWithUser(id: string): Promise<AppealWithUser | undefined> {
    const [row] = await this.db.select({ appeal: appeals, user: users }).from(appeals).innerJoin(users, eq(users.id, appeals.userId)).where(eq(appeals.id, id)).limit(1);
    return row;
  }

  /** Resuelve SOLO si sigue pendiente. */
  async resolve(id: string, status: 'accepted' | 'rejected', reviewerId: string, noteEncrypted: string | null): Promise<AppealRow | undefined> {
    const [row] = await this.db
      .update(appeals)
      .set({ status, reviewedBy: reviewerId, reviewedAt: new Date(), reviewNoteEncrypted: noteEncrypted })
      .where(and(eq(appeals.id, id), eq(appeals.status, 'pending')))
      .returning();
    return row;
  }
}
