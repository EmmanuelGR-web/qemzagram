import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GROUP_MAX_MEMBERS,
  type ConversationDto,
  type CreateGroupInput,
  type MessageDto,
} from '@qemzagram/shared';
import { CryptoService } from '../common/crypto.service';
import { toLimitedUser, toPublicUser } from '../common/mappers';
import { ContactsRepository } from '../database/repositories/contacts.repository';
import { ConversationsRepository, type MemberWithUser } from '../database/repositories/conversations.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { ConversationRow, MessageRow, UserRow } from '../database/schema';
import { RealtimePublisher } from '../realtime/realtime.port';

const NOT_FOUND = { code: 'CHAT_NOT_FOUND', message: 'No encontramos esa conversación' };
const UNAVAILABLE_BODY = '[Mensaje no disponible]';

@Injectable()
export class ChatsService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly users: UsersRepository,
    private readonly contacts: ContactsRepository,
    private readonly crypto: CryptoService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(userId: string): Promise<ConversationDto[]> {
    const rows = await this.conversations.listForUser(userId);
    const dtos = await this.toDtos(rows);
    return dtos.sort((a, b) => (b.lastMessage?.createdAt ?? b.createdAt).localeCompare(a.lastMessage?.createdAt ?? a.createdAt));
  }

  async get(userId: string, conversationId: string): Promise<ConversationDto> {
    const conversation = await this.requireMembership(userId, conversationId);
    const [dto] = await this.toDtos([conversation]);
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
    const [dto] = await this.toDtos([created]);
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
    }
    if (active.length + 1 > GROUP_MAX_MEMBERS) {
      throw new BadRequestException({ code: 'GROUP_FULL', message: `Un grupo admite hasta ${GROUP_MAX_MEMBERS} miembros` });
    }

    const created = await this.conversations.createGroup(userId, input.title, [userId, ...active.map((member) => member.id)]);
    const [dto] = await this.toDtos([created]);
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
      await this.conversations.deleteConversation(conversationId);
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
    return rows.map((row) => this.toMessageDto(row));
  }

  async sendMessage(userId: string, conversationId: string, body: string): Promise<MessageDto> {
    await this.requireMembership(userId, conversationId);
    const encrypted = this.crypto.encryptText(body, conversationId);
    const row = await this.conversations.insertMessage(conversationId, userId, encrypted);
    const dto = this.toMessageDto(row);
    const members = await this.conversations.getMembers([conversationId]);
    this.realtime.toUsers(
      members.map((member) => member.user.id),
      'chat:message',
      dto,
    );
    return dto;
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

  private async requireContact(userId: string, tag: string): Promise<UserRow> {
    const target = await this.users.findByTag(tag);
    if (!target || target.status !== 'active') throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'No encontramos ese tag' });
    if (target.id === userId) throw new BadRequestException({ code: 'CANNOT_ADD_SELF', message: 'No podés chatear con vos mismo' });
    if (!(await this.contacts.exists(userId, target.id))) {
      throw new BadRequestException({ code: 'NOT_IN_CONTACTS', message: 'Primero agregá a esta persona a tu agenda' });
    }
    return target;
  }

  private async toDtos(rows: ConversationRow[]): Promise<ConversationDto[]> {
    const ids = rows.map((row) => row.id);
    const [members, lastMessages] = await Promise.all([this.conversations.getMembers(ids), this.conversations.lastMessages(ids)]);
    const membersByConversation = new Map<string, MemberWithUser[]>();
    for (const member of members) {
      membersByConversation.set(member.conversationId, [...(membersByConversation.get(member.conversationId) ?? []), member]);
    }
    const lastByConversation = new Map<string, MessageRow>(lastMessages.map((message) => [message.conversationId, message]));

    return rows.map((row) => {
      const last = lastByConversation.get(row.id);
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        createdAt: row.createdAt.toISOString(),
        members: (membersByConversation.get(row.id) ?? []).map((member) => ({
          role: member.role,
          user: member.user.isPrivate ? toLimitedUser(member.user) : toPublicUser(member.user),
        })),
        lastMessage: last ? this.toMessageDto(last) : null,
      };
    });
  }

  private toMessageDto(row: MessageRow): MessageDto {
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
      createdAt: row.createdAt.toISOString(),
    };
  }
}
