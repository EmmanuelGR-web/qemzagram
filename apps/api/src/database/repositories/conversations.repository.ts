import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import {
  conversationMembers,
  conversations,
  messages,
  users,
  type ConversationRow,
  type MessageRow,
  type UserRow,
} from '../schema';

export interface MemberWithUser {
  conversationId: string;
  role: 'admin' | 'member';
  user: UserRow;
}

@Injectable()
export class ConversationsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findById(id: string): Promise<ConversationRow | undefined> {
    const [row] = await this.db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    return row;
  }

  async findDirectByKey(directKey: string): Promise<ConversationRow | undefined> {
    const [row] = await this.db.select().from(conversations).where(eq(conversations.directKey, directKey)).limit(1);
    return row;
  }

  async createDirect(createdBy: string, directKey: string, memberIds: string[]): Promise<ConversationRow> {
    return this.db.transaction(async (tx) => {
      const [conversation] = await tx
        .insert(conversations)
        .values({ type: 'direct', directKey, createdBy })
        .returning();
      if (!conversation) throw new Error('No se pudo crear la conversación');
      await tx
        .insert(conversationMembers)
        .values(memberIds.map((userId) => ({ conversationId: conversation.id, userId, role: 'member' as const })));
      return conversation;
    });
  }

  async createGroup(createdBy: string, title: string, memberIds: string[]): Promise<ConversationRow> {
    return this.db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({ type: 'group', title, createdBy }).returning();
      if (!conversation) throw new Error('No se pudo crear el grupo');
      await tx.insert(conversationMembers).values(
        memberIds.map((userId) => ({
          conversationId: conversation.id,
          userId,
          role: userId === createdBy ? ('admin' as const) : ('member' as const),
        })),
      );
      return conversation;
    });
  }

  async listForUser(userId: string): Promise<ConversationRow[]> {
    const rows = await this.db
      .select({ conversation: conversations })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(eq(conversationMembers.userId, userId));
    return rows.map((row) => row.conversation);
  }

  async getMembers(conversationIds: string[]): Promise<MemberWithUser[]> {
    if (conversationIds.length === 0) return [];
    return this.db
      .select({ conversationId: conversationMembers.conversationId, role: conversationMembers.role, user: users })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(inArray(conversationMembers.conversationId, conversationIds));
  }

  async getMemberRole(conversationId: string, userId: string): Promise<'admin' | 'member' | undefined> {
    const [row] = await this.db
      .select({ role: conversationMembers.role })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
      .limit(1);
    return row?.role;
  }

  async countMembers(conversationId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId));
    return row?.total ?? 0;
  }

  async addMember(conversationId: string, userId: string): Promise<void> {
    await this.db.insert(conversationMembers).values({ conversationId, userId, role: 'member' }).onConflictDoNothing();
  }

  async setMemberRole(conversationId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
    await this.db
      .update(conversationMembers)
      .set({ role })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.db.delete(conversations).where(eq(conversations.id, conversationId));
  }

  async removeMember(conversationId: string, userId: string): Promise<void> {
    await this.db
      .delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  }

  async insertMessage(conversationId: string, senderId: string, encryptedBody: string): Promise<MessageRow> {
    const [row] = await this.db
      .insert(messages)
      .values({ conversationId, senderId, body: encryptedBody })
      .returning();
    if (!row) throw new Error('No se pudo guardar el mensaje');
    return row;
  }

  async listMessages(conversationId: string, limit: number, before?: Date): Promise<MessageRow[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        before
          ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, before))
          : eq(messages.conversationId, conversationId),
      )
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  /** Último mensaje de cada conversación (una sola consulta, sin N+1). */
  async lastMessages(conversationIds: string[]): Promise<MessageRow[]> {
    if (conversationIds.length === 0) return [];
    return this.db
      .selectDistinctOn([messages.conversationId])
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(messages.conversationId, desc(messages.createdAt));
  }
}
