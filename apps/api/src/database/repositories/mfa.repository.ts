import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { mfaBackupCodes } from '../schema';

@Injectable()
export class MfaRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Reemplaza TODOS los códigos de respaldo (los anteriores dejan de servir). */
  async replaceBackupCodes(userId: string, hashes: string[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, userId));
      if (hashes.length > 0) await tx.insert(mfaBackupCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
    });
  }

  /** Marca un código como usado SOLO si existía y no se había usado (atómico: no sirve dos veces). */
  async consumeBackupCode(userId: string, codeHash: string): Promise<boolean> {
    const rows = await this.db
      .update(mfaBackupCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(mfaBackupCodes.userId, userId), eq(mfaBackupCodes.codeHash, codeHash), isNull(mfaBackupCodes.usedAt)))
      .returning({ id: mfaBackupCodes.id });
    return rows.length > 0;
  }

  async countBackupCodesLeft(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(mfaBackupCodes)
      .where(and(eq(mfaBackupCodes.userId, userId), isNull(mfaBackupCodes.usedAt)));
    return row?.total ?? 0;
  }

  async deleteBackupCodes(userId: string): Promise<void> {
    await this.db.delete(mfaBackupCodes).where(eq(mfaBackupCodes.userId, userId));
  }
}
