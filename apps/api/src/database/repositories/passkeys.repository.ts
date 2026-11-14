import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { passkeys, type PasskeyRow } from '../schema';

export type NewPasskey = Pick<PasskeyRow, 'userId' | 'credentialId' | 'publicKey' | 'counter' | 'transports' | 'deviceType' | 'backedUp' | 'name'>;

@Injectable()
export class PasskeysRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listForUser(userId: string): Promise<PasskeyRow[]> {
    return this.db.select().from(passkeys).where(eq(passkeys.userId, userId)).orderBy(asc(passkeys.createdAt));
  }

  async countForUser(userId: string): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(passkeys).where(eq(passkeys.userId, userId));
    return row?.total ?? 0;
  }

  async findOwnedByCredentialId(userId: string, credentialId: string): Promise<PasskeyRow | undefined> {
    const [row] = await this.db
      .select()
      .from(passkeys)
      .where(and(eq(passkeys.userId, userId), eq(passkeys.credentialId, credentialId)))
      .limit(1);
    return row;
  }

  async existsCredential(credentialId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
    return Boolean(row);
  }

  async create(values: NewPasskey): Promise<PasskeyRow> {
    const [row] = await this.db.insert(passkeys).values(values).returning();
    if (!row) throw new Error('No se pudo guardar la llave de acceso');
    return row;
  }

  async markUsed(id: string, counter: number): Promise<void> {
    await this.db.update(passkeys).set({ counter, lastUsedAt: new Date() }).where(eq(passkeys.id, id));
  }

  async deleteOwned(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(passkeys)
      .where(and(eq(passkeys.userId, userId), eq(passkeys.id, id)))
      .returning({ id: passkeys.id });
    return rows.length > 0;
  }
}
