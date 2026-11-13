import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { callParticipants, calls, conversationMembers, users, type CallParticipantRow, type CallRow, type UserRow } from '../schema';

export interface ParticipantWithUser {
  callId: string;
  state: CallParticipantRow['state'];
  user: UserRow;
}

type CallKind = CallRow['kind'];
type EndReason = NonNullable<CallRow['endReason']>;
type ParticipantState = CallParticipantRow['state'];

/** Error de Postgres por violar un índice único (acá: ya hay una llamada en curso en el chat). */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } }).code ?? (error as { cause?: { code?: unknown } }).cause?.code;
  return code === '23505';
}

/** Única capa que consulta las llamadas. Los cambios de estado son condicionales (atómicos). */
@Injectable()
export class CallsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Crea la llamada con sus participantes (quien llama ya figura "joined").
   * Devuelve `undefined` si ya había una llamada en curso en esa conversación.
   */
  async create(conversationId: string, startedBy: string, kind: CallKind, invitedIds: string[], now: Date): Promise<CallRow | undefined> {
    try {
      return await this.db.transaction(async (tx) => {
        const [call] = await tx.insert(calls).values({ conversationId, startedBy, kind, createdAt: now }).returning();
        if (!call) throw new Error('No se pudo crear la llamada');
        await tx.insert(callParticipants).values([
          { callId: call.id, userId: startedBy, state: 'joined', joinedAt: now },
          ...invitedIds.map((userId) => ({ callId: call.id, userId, state: 'invited' as const })),
        ]);
        return call;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return undefined;
      throw error;
    }
  }

  async findById(id: string): Promise<CallRow | undefined> {
    const [row] = await this.db.select().from(calls).where(eq(calls.id, id)).limit(1);
    return row;
  }

  async findManyByIds(ids: string[]): Promise<CallRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(calls).where(inArray(calls.id, ids));
  }

  async findOpenByConversation(conversationId: string): Promise<CallRow | undefined> {
    const [row] = await this.db
      .select()
      .from(calls)
      .where(and(eq(calls.conversationId, conversationId), ne(calls.status, 'ended')))
      .limit(1);
    return row;
  }

  /** Llamadas en curso de conversaciones de las que `userId` es miembro HOY. */
  listOpenForMember(userId: string): Promise<CallRow[]> {
    return this.db
      .select({ call: calls })
      .from(calls)
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, calls.conversationId), eq(conversationMembers.userId, userId)))
      .where(ne(calls.status, 'ended'))
      .then((rows) => rows.map((row) => row.call));
  }

  async getParticipants(callIds: string[]): Promise<ParticipantWithUser[]> {
    if (callIds.length === 0) return [];
    return this.db
      .select({ callId: callParticipants.callId, state: callParticipants.state, user: users })
      .from(callParticipants)
      .innerJoin(users, eq(users.id, callParticipants.userId))
      .where(inArray(callParticipants.callId, callIds));
  }

  async getParticipantState(callId: string, userId: string): Promise<ParticipantState | undefined> {
    const [row] = await this.db
      .select({ state: callParticipants.state })
      .from(callParticipants)
      .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, userId)))
      .limit(1);
    return row?.state;
  }

  /** Crea o actualiza el estado de una persona en la llamada. */
  async setParticipantState(callId: string, userId: string, state: ParticipantState, now: Date): Promise<void> {
    const times = state === 'joined' ? { joinedAt: now, leftAt: null } : state === 'left' ? { leftAt: now } : {};
    await this.db
      .insert(callParticipants)
      .values({ callId, userId, state, ...times })
      .onConflictDoUpdate({ target: [callParticipants.callId, callParticipants.userId], set: { state, ...times } });
  }

  async countJoined(callId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(callParticipants)
      .where(and(eq(callParticipants.callId, callId), eq(callParticipants.state, 'joined')));
    return row?.total ?? 0;
  }

  async countInvited(callId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(callParticipants)
      .where(and(eq(callParticipants.callId, callId), eq(callParticipants.state, 'invited')));
    return row?.total ?? 0;
  }

  /** Pasa de "sonando" a "en curso" (solo la primera vez que alguien atiende). */
  async markAnswered(id: string, now: Date): Promise<CallRow | undefined> {
    const [row] = await this.db
      .update(calls)
      .set({ status: 'active', answeredAt: now })
      .where(and(eq(calls.id, id), eq(calls.status, 'ringing')))
      .returning();
    return row;
  }

  /**
   * Termina la llamada. Es condicional: si ya había terminado devuelve `undefined`,
   * así dos pedidos simultáneos no la terminan dos veces.
   */
  async end(id: string, reason: EndReason, now: Date): Promise<CallRow | undefined> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(calls)
        .set({ status: 'ended', endReason: reason, endedAt: now })
        .where(and(eq(calls.id, id), ne(calls.status, 'ended')))
        .returning();
      if (row) {
        await tx
          .update(callParticipants)
          .set({ state: 'left', leftAt: now })
          .where(and(eq(callParticipants.callId, id), eq(callParticipants.state, 'joined')));
      }
      return row;
    });
  }

  /** Llamadas que siguen sonando desde antes de `cutoff`. */
  listRingingSince(cutoff: Date): Promise<CallRow[]> {
    return this.db
      .select()
      .from(calls)
      .where(and(eq(calls.status, 'ringing'), lte(calls.createdAt, cutoff)));
  }

  /** Llamadas en curso desde antes de `cutoff` (límite de duración). */
  listActiveSince(cutoff: Date): Promise<CallRow[]> {
    return this.db
      .select()
      .from(calls)
      .where(and(eq(calls.status, 'active'), lte(calls.answeredAt, cutoff)));
  }
}
