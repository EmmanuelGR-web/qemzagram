import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { attachments, messages, type AttachmentRow, type MessageRow, type NewAttachmentRow } from '../schema';

export type AttachmentFields = Omit<NewAttachmentRow, 'messageId' | 'conversationId' | 'uploaderId' | 'createdAt'> & { id: string };

@Injectable()
export class AttachmentsRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Crea el mensaje y su adjunto en una sola transacción: nunca queda uno sin el otro. */
  async createWithMessage(
    conversationId: string,
    senderId: string,
    encryptedBody: string,
    fields: AttachmentFields,
  ): Promise<{ message: MessageRow; attachment: AttachmentRow }> {
    return this.db.transaction(async (tx) => {
      const [message] = await tx.insert(messages).values({ conversationId, senderId, body: encryptedBody }).returning();
      if (!message) throw new Error('No se pudo guardar el mensaje');
      const [attachment] = await tx
        .insert(attachments)
        .values({ ...fields, messageId: message.id, conversationId, uploaderId: senderId })
        .returning();
      if (!attachment) throw new Error('No se pudo guardar el adjunto');
      return { message, attachment };
    });
  }

  async findById(id: string): Promise<AttachmentRow | undefined> {
    const [row] = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    return row;
  }

  async findByMessageIds(messageIds: string[]): Promise<AttachmentRow[]> {
    if (messageIds.length === 0) return [];
    return this.db.select().from(attachments).where(inArray(attachments.messageId, messageIds));
  }

  /** Claves de almacenamiento de una conversación (para borrar los archivos cuando se elimina). */
  async storageKeysForConversation(conversationId: string): Promise<string[]> {
    const rows = await this.db
      .select({ storageKey: attachments.storageKey })
      .from(attachments)
      .where(eq(attachments.conversationId, conversationId));
    return rows.map((row) => row.storageKey);
  }
}
