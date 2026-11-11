import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { emailTokens, sessions, users, type EmailTokenRow } from '../schema';

export type EmailTokenType = 'verify' | 'reset';

@Injectable()
export class EmailTokensRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Crea un token nuevo e invalida los anteriores sin usar del mismo tipo. */
  async issue(userId: string, type: EmailTokenType, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(emailTokens)
        .set({ usedAt: new Date() })
        .where(and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)));
      await tx.insert(emailTokens).values({ userId, type, tokenHash, expiresAt });
    });
  }

  async findValid(tokenHash: string, type: EmailTokenType): Promise<EmailTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(emailTokens)
      .where(
        and(
          eq(emailTokens.tokenHash, tokenHash),
          eq(emailTokens.type, type),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return row;
  }

  /** Marca el correo como verificado y consume el token en una sola transacción. */
  async consumeVerification(tokenId: string, userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(emailTokens).set({ usedAt: new Date() }).where(eq(emailTokens.id, tokenId));
      await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
    });
  }

  /** Cambia la contraseña, consume el token y cierra TODAS las sesiones abiertas. */
  async consumeReset(tokenId: string, userId: string, passwordHash: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(emailTokens).set({ usedAt: now }).where(eq(emailTokens.id, tokenId));
      await tx
        .update(users)
        .set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: now })
        .where(eq(users.id, userId));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    });
  }
}
