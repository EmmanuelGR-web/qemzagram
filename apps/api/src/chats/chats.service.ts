import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  GROUP_MAX_MEMBERS,
  type ConversationDto,
  type CreateGroupInput,
  type GeneralStickerCode,
  type CallSummaryDto,
  type MessageDto,
  type SendAttachmentInput,
  type SendStickerInput,
  STICKER_SIZE,
} from '@qemzagram/shared';
import { randomUUID } from 'node:crypto';
import { BlocksService, USER_NOT_FOUND } from '../blocks/blocks.service';
import { CryptoService } from '../common/crypto.service';
import { toLimitedUser, toPublicUser } from '../common/mappers';
import { AttachmentsRepository } from '../database/repositories/attachments.repository';
import { CallsRepository } from '../database/repositories/calls.repository';
import { ContactsRepository } from '../database/repositories/contacts.repository';
import { ConversationsRepository, type MemberWithUser } from '../database/repositories/conversations.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { AttachmentRow, CallRow, ConversationRow, MessageRow, UserRow } from '../database/schema';
import { MediaProcessor, type ProcessedMedia, type UploadedInput } from '../media/media-processor.service';
import { MediaService } from '../media/media.service';
import { RealtimePublisher } from '../realtime/realtime.port';
import { StickersService } from '../stickers/stickers.service';
import { BlobStorage } from '../storage/blob-storage.port';

const NOT_FOUND = { code: 'CHAT_NOT_FOUND', message: 'No encontramos esa conversación' };
const UNAVAILABLE_BODY = '[Mensaje no disponible]';
/** Mismo aviso para las dos personas: no se revela quién bloqueó a quién. */
export const CHAT_BLOCKED = { code: 'CHAT_BLOCKED', message: 'No podés enviar mensajes ni llamar en este chat' };

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly users: UsersRepository,
    private readonly contacts: ContactsRepository,
    private readonly attachments: AttachmentsRepository,
    private readonly crypto: CryptoService,
    private readonly realtime: RealtimePublisher,
    private readonly media: MediaService,
    private readonly processor: MediaProcessor,
    private readonly storage: BlobStorage,
    private readonly stickers: StickersService,
    private readonly calls: CallsRepository,
    private readonly blocks: BlocksService,
  ) {}

  async list(userId: string): Promise<ConversationDto[]> {
    const rows = await this.conversations.listForUser(userId);
    const dtos = await this.toDtos(rows, userId);
    return dtos.sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
  }

  async get(userId: string, conversationId: string): Promise<ConversationDto> {
    const conversation = await this.requireMembership(userId, conversationId);
    const [dto] = await this.toDtos([conversation], userId);
    if (!dto) throw new NotFoundException(NOT_FOUND);
    return dto;
  }

  /** Abre (o crea) el chat 1 a 1 con alguien de tu agenda. */
  async openDirect(userId: string, tag: string): Promise<ConversationDto> {
    const target = await this.requireContact(userId, tag);
    const directKey = [userId, target.id].sort().join(':');

    const existing = await this.conversations.findDirectByKey(directKey);
    if (existing) return this.get(userId, existing.id);

    const created = await this.conversations.createDirect(userId, directKey, [userId, target.id]);
    const [dto] = await this.toDtos([created], userId);
    if (!dto) throw new NotFoundException(NOT_FOUND);
    this.realtime.toUsers([target.id], 'chat:created', dto);
    return dto;
  }

  /** Crea un grupo de hasta 10 miembros (incluida la persona que lo crea). Solo con gente de tu agenda. */
  async createGroup(userId: string, input: CreateGroupInput): Promise<ConversationDto> {
    const tags = [...new Set(input.memberTags)];
    const members = await this.users.findManyByTags(tags);
    const active = members.filter((member) => member.status === 'active' && member.id !== userId);
    if (active.length !== tags.length) {
      throw new BadRequestException({ code: 'INVALID_MEMBERS', message: 'Alguno de los tags no existe o es el tuyo' });
    }
    for (const member of active) {
      if (!(await this.contacts.exists(userId, member.id))) {
        throw new BadRequestException({ code: 'NOT_IN_CONTACTS', message: `@${member.tag} no está en tu agenda` });
      }
      await this.blocks.assertCanReach(userId, member);
    }
    if (active.length + 1 > GROUP_MAX_MEMBERS) {
      throw new BadRequestException({ code: 'GROUP_FULL', message: `Un grupo admite hasta ${GROUP_MAX_MEMBERS} miembros` });
    }

    const created = await this.conversations.createGroup(userId, input.title, [userId, ...active.map((member) => member.id)]);
    const [dto] = await this.toDtos([created], userId);
    if (!dto) throw new NotFoundException(NOT_FOUND);
    this.realtime.toUsers(
      active.map((member) => member.id),
      'chat:created',
      dto,
    );
    return dto;
  }

  async addMember(userId: string, conversationId: string, tag: string): Promise<ConversationDto> {
    const conversation = await this.requireMembership(userId, conversationId);
    if (conversation.type !== 'group') throw new BadRequestException({ code: 'NOT_A_GROUP', message: 'Solo los grupos admiten más miembros' });
    if ((await this.conversations.getMemberRole(conversationId, userId)) !== 'admin') {
      throw new BadRequestException({ code: 'ADMIN_REQUIRED', message: 'Solo los administradores pueden agregar miembros' });
    }
    const target = await this.requireContact(userId, tag);
    if (await this.conversations.getMemberRole(conversationId, target.id)) {
      throw new ConflictException({ code: 'ALREADY_MEMBER', message: 'Esa persona ya está en el grupo' });
    }
    if ((await this.conversations.countMembers(conversationId)) >= GROUP_MAX_MEMBERS) {
      throw new BadRequestException({ code: 'GROUP_FULL', message: `Un grupo admite hasta ${GROUP_MAX_MEMBERS} miembros` });
    }
    await this.conversations.addMember(conversationId, target.id);
    const dto = await this.get(userId, conversationId);
    this.realtime.toUsers(
      dto.members.map((member) => member.user.id),
      'chat:updated',
      dto,
    );
    return dto;
  }

  async leave(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.requireMembership(userId, conversationId);
    if (conversation.type !== 'group') throw new BadRequestException({ code: 'NOT_A_GROUP', message: 'Solo podés salir de grupos' });

    await this.conversations.removeMember(conversationId, userId);
    const remaining = await this.conversations.getMembers([conversationId]);
    if (remaining.length === 0) {
      // Se borran también los archivos: la base los elimina en cascada, el almacenamiento no.
      const keys = await this.attachments.storageKeysForConversation(conversationId);
      await this.conversations.deleteConversation(conversationId);
      await this.deleteBlobs(keys);
      return;
    }
    if (!remaining.some((member) => member.role === 'admin') && remaining[0]) {
      await this.conversations.setMemberRole(conversationId, remaining[0].user.id, 'admin');
    }
    const dto = await this.get(remaining[0]?.user.id ?? userId, conversationId).catch(() => null);
    if (dto) {
      this.realtime.toUsers(
        dto.members.map((member) => member.user.id),
        'chat:updated',
        dto,
      );
    }
  }

  async listMessages(userId: string, conversationId: string, limit: number, before?: string): Promise<MessageDto[]> {
    await this.requireMembership(userId, conversationId);
    const rows = await this.conversations.listMessages(conversationId, limit, before ? new Date(before) : undefined);
    return this.toMessageDtos(rows);
  }

  async sendMessage(userId: string, conversationId: string, body: string): Promise<MessageDto> {
    await this.requireCanSend(userId, conversationId);
    const encrypted = this.crypto.encryptText(body, conversationId);
    const row = await this.conversations.insertMessage(conversationId, userId, encrypted);
    return this.publish(this.toMessageDto(row, null));
  }

  /** Envía un archivo (imagen, documento, nota de voz o video) con un epígrafe opcional. */
  async sendAttachment(userId: string, conversationId: string, input: SendAttachmentInput, file: UploadedInput): Promise<MessageDto> {
    await this.requireCanSend(userId, conversationId);
    const processed = await this.processor.process(input.kind, file, userId);
    return this.storeAndPublish(userId, conversationId, input.kind, processed, input.caption.trim());
  }

  /**
   * Envía un sticker: del pack general (solo se guarda el código) o uno propio.
   * El propio se COPIA como adjunto: los miembros lo ven sin acceder a la colección de quien lo envía,
   * y borrarlo después de "Mis stickers" no rompe los mensajes ya enviados.
   */
  async sendSticker(userId: string, conversationId: string, input: SendStickerInput): Promise<MessageDto> {
    await this.requireCanSend(userId, conversationId);
    if ('code' in input) {
      const row = await this.conversations.insertMessage(conversationId, userId, this.crypto.encryptText('', conversationId), input.code);
      return this.publish(this.toMessageDto(row, null));
    }
    const image = await this.stickers.readOwned(userId, input.stickerId);
    const processed: ProcessedMedia = { data: image, mimeType: 'image/webp', name: null, width: STICKER_SIZE, height: STICKER_SIZE, durationMs: null };
    return this.storeAndPublish(userId, conversationId, 'sticker', processed, '');
  }

  /**
   * Guarda el archivo cifrado (AAD = id del adjunto) y crea mensaje + adjunto en una transacción.
   * Si la base falla, se borra el archivo para no dejar basura.
   */
  private async storeAndPublish(
    userId: string,
    conversationId: string,
    kind: AttachmentRow['kind'],
    processed: ProcessedMedia,
    caption: string,
  ): Promise<MessageDto> {
    const attachmentId = randomUUID();
    const storageKey = randomUUID();
    await this.storage.put(storageKey, this.crypto.encryptBlob(processed.data, attachmentId));
    try {
      const { message, attachment } = await this.attachments.createWithMessage(
        conversationId,
        userId,
        this.crypto.encryptText(caption, conversationId),
        {
          id: attachmentId,
          kind,
          storageKey,
          mimeType: processed.mimeType,
          sizeBytes: processed.data.length,
          nameEncrypted: processed.name ? this.media.encryptName(processed.name, attachmentId) : null,
          width: processed.width,
          height: processed.height,
          durationMs: processed.durationMs,
        },
      );
      return this.publish(this.toMessageDto(message, attachment));
    } catch (error) {
      await this.deleteBlobs([storageKey]);
      throw error;
    }
  }

  /**
   * Deja en el chat el registro de una llamada terminada ("Llamada perdida", "Videollamada · 3:12").
   * Lo "envía" quien llamó; no tiene texto (el cuerpo cifrado va vacío).
   */
  async postCallLog(call: CallRow): Promise<MessageDto> {
    const row = await this.conversations.insertMessage(call.conversationId, call.startedBy, this.crypto.encryptText('', call.conversationId), null, call.id);
    return this.publish(this.toMessageDto(row, null, call));
  }

  /** Entrega el mensaje en tiempo real a todos los miembros. */
  private async publish(dto: MessageDto): Promise<MessageDto> {
    const members = await this.conversations.getMembers([dto.conversationId]);
    this.realtime.toUsers(
      members.map((member) => member.user.id),
      'chat:message',
      dto,
    );
    return dto;
  }

  private async deleteBlobs(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.storage.delete(key).catch((error: Error) => this.logger.error(`No se pudo borrar un archivo: ${error.message}`));
    }
  }

  // ---------- helpers ----------

  private async requireMembership(userId: string, conversationId: string): Promise<ConversationRow> {
    const conversation = await this.conversations.findById(conversationId);
    // Mismo error si no existe o si no sos miembro: no se revela qué conversaciones existen.
    if (!conversation || !(await this.conversations.getMemberRole(conversationId, userId))) {
      throw new NotFoundException(NOT_FOUND);
    }
    return conversation;
  }

  /**
   * Miembro + (en chats 1 a 1) sin bloqueo entre las dos personas.
   * En grupos el bloqueo no impide escribir: el grupo es de todos sus miembros.
   */
  async requireCanSend(userId: string, conversationId: string): Promise<ConversationRow> {
    const conversation = await this.requireMembership(userId, conversationId);
    if (conversation.type === 'direct') {
      const members = await this.conversations.getMembers([conversationId]);
      const other = members.find((member) => member.user.id !== userId);
      if (other && (await this.blocks.isBlockedEither(userId, other.user.id))) throw new ForbiddenException(CHAT_BLOCKED);
    }
    return conversation;
  }

  private async requireContact(userId: string, tag: string): Promise<UserRow> {
    const target = await this.users.findByTag(tag);
    if (!target || target.status !== 'active') throw new NotFoundException(USER_NOT_FOUND);
    if (target.id === userId) throw new BadRequestException({ code: 'CANNOT_ADD_SELF', message: 'No podés chatear con vos mismo' });
    await this.blocks.assertCanReach(userId, target);
    if (!(await this.contacts.exists(userId, target.id))) {
      throw new BadRequestException({ code: 'NOT_IN_CONTACTS', message: 'Primero agregá a esta persona a tu agenda' });
    }
    return target;
  }

  /**
   * `viewerId`: quien recibe el DTO. Quien lo bloqueó se ve con perfil reducido,
   * y en chats 1 a 1 se indica si el viewer bloqueó a la otra persona.
   */
  private async toDtos(rows: ConversationRow[], viewerId: string): Promise<ConversationDto[]> {
    const ids = rows.map((row) => row.id);
    const [members, lastMessages] = await Promise.all([this.conversations.getMembers(ids), this.conversations.lastMessages(ids)]);
    const otherIds = [...new Set(members.map((member) => member.user.id).filter((id) => id !== viewerId))];
    const [blockedByMe, blockers] = await Promise.all([this.blocks.blockedByMeAmong(viewerId, otherIds), this.blocks.blockersAmong(viewerId, otherIds)]);
    const membersByConversation = new Map<string, MemberWithUser[]>();
    for (const member of members) {
      membersByConversation.set(member.conversationId, [...(membersByConversation.get(member.conversationId) ?? []), member]);
    }
    const lastByConversation = new Map<string, MessageDto>(
      (await this.toMessageDtos(lastMessages)).map((message) => [message.conversationId, message]),
    );

    return rows.map((row) => {
      const last = lastByConversation.get(row.id);
      const rowMembers = membersByConversation.get(row.id) ?? [];
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        createdAt: row.createdAt.toISOString(),
        members: rowMembers.map((member) => ({
          role: member.role,
          user: member.user.isPrivate || blockers.has(member.user.id) ? toLimitedUser(member.user) : toPublicUser(member.user),
        })),
        lastMessage: last ?? null,
        blockedByMe: row.type === 'direct' && rowMembers.some((member) => blockedByMe.has(member.user.id)),
      };
    });
  }

  /** Convierte mensajes a DTO trayendo adjuntos y llamadas en una consulta cada uno (sin N+1). */
  private async toMessageDtos(rows: MessageRow[]): Promise<MessageDto[]> {
    const callIds = rows.flatMap((row) => (row.callId ? [row.callId] : []));
    const [found, callRows] = await Promise.all([this.attachments.findByMessageIds(rows.map((row) => row.id)), this.calls.findManyByIds(callIds)]);
    const byMessage = new Map(found.map((attachment) => [attachment.messageId, attachment]));
    const byCall = new Map(callRows.map((call) => [call.id, call]));
    return rows.map((row) => this.toMessageDto(row, byMessage.get(row.id) ?? null, (row.callId ? byCall.get(row.callId) : undefined) ?? null));
  }

  private toMessageDto(row: MessageRow, attachment: AttachmentRow | null, call: CallRow | null = null): MessageDto {
    let body: string;
    try {
      body = this.crypto.decryptText(row.body, row.conversationId);
    } catch {
      body = UNAVAILABLE_BODY;
    }
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderId: row.senderId,
      body,
      attachment: attachment ? this.media.toAttachmentDto(attachment) : null,
      sticker: (row.stickerCode as GeneralStickerCode | null) ?? null,
      call: call ? toCallSummary(call) : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

function toCallSummary(call: CallRow): CallSummaryDto {
  const durationMs = call.answeredAt && call.endedAt ? call.endedAt.getTime() - call.answeredAt.getTime() : null;
  return { id: call.id, kind: call.kind, endReason: call.endReason, durationMs };
}
