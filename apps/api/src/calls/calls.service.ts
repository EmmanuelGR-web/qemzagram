import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CALL_MAX_HOURS, CALL_RING_SECONDS, type CallDto, type CallJoinDto, type CallKind, type PushPayload } from '@qemzagram/shared';
import { BlocksService } from '../blocks/blocks.service';
import { ChatsService } from '../chats/chats.service';
import { toLimitedUser, toPublicUser } from '../common/mappers';
import { CallsRepository, type ParticipantWithUser } from '../database/repositories/calls.repository';
import { ConversationsRepository, type MemberWithUser } from '../database/repositories/conversations.repository';
import type { CallRow, ConversationRow } from '../database/schema';
import { PushService } from '../notifications/push.service';
import { RealtimePublisher } from '../realtime/realtime.port';
import { CallMediaPort, type CallMediaEvent } from './call-media.port';

const NOT_FOUND = { code: 'CALL_NOT_FOUND', message: 'No encontramos esa llamada' };
const CHAT_NOT_FOUND = { code: 'CHAT_NOT_FOUND', message: 'No encontramos esa conversación' };

type EndReason = NonNullable<CallRow['endReason']>;

/** Tema de la notificación (máx. 32 caracteres url-safe): el id de la llamada sin guiones. */
const pushTopic = (call: CallRow) => call.id.replace(/-/g, '');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Llamadas y videollamadas (1 a 1 y grupos de hasta 10).
 * Reglas: solo miembros ACTUALES de la conversación ven, inician o entran a una llamada;
 * para cualquier otra persona la llamada "no existe". Una sola llamada en curso por chat.
 */
@Injectable()
export class CallsService {
  constructor(
    private readonly calls: CallsRepository,
    private readonly conversations: ConversationsRepository,
    private readonly media: CallMediaPort,
    private readonly realtime: RealtimePublisher,
    private readonly chats: ChatsService,
    private readonly push: PushService,
    private readonly blocks: BlocksService,
  ) {}

  /** Inicia una llamada en un chat y devuelve el acceso a la sala para quien llama. */
  async start(userId: string, conversationId: string, kind: CallKind): Promise<CallJoinDto> {
    // En chats 1 a 1 con bloqueo no se puede llamar (mismo error que al escribir).
    const conversation = await this.chats.requireCanSend(userId, conversationId);
    this.assertAvailable();

    const members = await this.conversations.getMembers([conversationId]);
    const candidates = members.filter((member) => member.user.id !== userId && member.user.status === 'active').map((member) => member.user.id);
    // En grupos, a quien tiene un bloqueo con quien llama no le suena (ni se entera).
    const blocked = await this.blocks.blockedEitherAmong(userId, candidates);
    const invited = candidates.filter((id) => !blocked.has(id));
    if (invited.length === 0) throw new BadRequestException({ code: 'NO_ONE_TO_CALL', message: 'No hay nadie a quien llamar en este chat' });

    const now = new Date();
    const created = await this.calls.create(conversationId, userId, kind, invited, now);
    if (!created) {
      const open = await this.calls.findOpenByConversation(conversationId);
      throw new ConflictException({ code: 'CALL_IN_PROGRESS', message: 'Ya hay una llamada en curso en este chat', callId: open?.id });
    }
    const dto = await this.toDto(created, conversation);
    this.realtime.toUsers(invited, 'call:incoming', dto);
    // Notificación push para quien tenga la app cerrada (sin esperar: no demora la llamada).
    void this.push.notify(invited, { type: 'call', ...this.pushInfo(created, conversation, members) }, { ttl: CALL_RING_SECONDS, urgency: 'high', topic: pushTopic(created) });
    return { call: dto, token: await this.tokenFor(created, userId), url: this.media.url };
  }

  /** Atender o sumarse a una llamada en curso. */
  async join(userId: string, callId: string): Promise<CallJoinDto> {
    const { call, conversation } = await this.requireCall(userId, callId);
    if (call.status === 'ended') throw new ConflictException({ code: 'CALL_ENDED', message: 'La llamada ya terminó' });
    // Si hubo un bloqueo mientras sonaba, en un chat 1 a 1 ya no se puede atender.
    if (conversation.type === 'direct') await this.chats.requireCanSend(userId, conversation.id);
    this.assertAvailable();

    const now = new Date();
    await this.calls.setParticipantState(call.id, userId, 'joined', now);
    const current = (call.status === 'ringing' && call.startedBy !== userId ? await this.calls.markAnswered(call.id, now) : undefined) ?? call;
    const dto = await this.publishUpdate(current, conversation);
    void this.notifyClosed(current, conversation, [userId], false);
    return { call: dto, token: await this.tokenFor(current, userId), url: this.media.url };
  }

  /** Rechazar una llamada entrante. En un chat 1 a 1, la llamada termina. */
  async decline(userId: string, callId: string): Promise<CallDto> {
    const { call, conversation } = await this.requireCall(userId, callId);
    if (call.status === 'ended') return this.toDto(call, conversation);
    if (call.startedBy === userId) return this.leave(userId, callId);

    await this.calls.setParticipantState(call.id, userId, 'declined', new Date());
    void this.notifyClosed(call, conversation, [userId], false);
    if (conversation.type === 'direct') return this.finish(call, conversation, 'declined');
    return this.settleGroup(call, conversation);
  }

  /** Cortar / salir de la llamada. */
  async leave(userId: string, callId: string): Promise<CallDto> {
    const { call, conversation } = await this.requireCall(userId, callId);
    if (call.status === 'ended') return this.toDto(call, conversation);

    await this.calls.setParticipantState(call.id, userId, 'left', new Date());
    await this.media.removeParticipant(call.id, userId);
    if (conversation.type === 'direct') return this.finish(call, conversation, call.status === 'active' ? 'completed' : 'cancelled');
    return this.settleGroup(call, conversation);
  }

  async get(userId: string, callId: string): Promise<CallDto> {
    const { call, conversation } = await this.requireCall(userId, callId);
    return this.toDto(call, conversation);
  }

  /** Llamadas en curso en mis chats (para mostrar una entrante al abrir la app). */
  async listOpen(userId: string): Promise<CallDto[]> {
    const rows = await this.calls.listOpenForMember(userId);
    return Promise.all(
      rows.map(async (row) => {
        const conversation = await this.conversations.findById(row.conversationId);
        if (!conversation) throw new NotFoundException(NOT_FOUND);
        return this.toDto(row, conversation);
      }),
    );
  }

  /**
   * Corta lo que quedó colgado: llamadas que sonaron más de 45 s sin que nadie atienda ("perdidas")
   * y llamadas que superaron la duración máxima. Lo llama un temporizador (ver CallsTimeoutService).
   */
  async expire(now = new Date()): Promise<number> {
    const ringing = await this.calls.listRingingSince(new Date(now.getTime() - CALL_RING_SECONDS * 1000));
    const tooLong = await this.calls.listActiveSince(new Date(now.getTime() - CALL_MAX_HOURS * 60 * 60 * 1000));
    let ended = 0;
    for (const [rows, reason] of [
      [ringing, 'missed'],
      [tooLong, 'completed'],
    ] as const) {
      for (const call of rows) {
        const conversation = await this.conversations.findById(call.conversationId);
        if (conversation && (await this.finish(call, conversation, reason, now)).status === 'ended') ended++;
      }
    }
    return ended;
  }

  /**
   * Aviso VERIFICADO del servidor de medios: alguien salió de la sala sin pasar por la API
   * (cerró el navegador, se quedó sin red) o la sala se cerró. Mantiene la base al día.
   */
  async handleMediaEvent(event: CallMediaEvent): Promise<void> {
    // Las salas se llaman como la llamada (UUID); cualquier otra sala no es nuestra.
    if (!UUID_REGEX.test(event.room) || (event.type === 'participant_left' && !UUID_REGEX.test(event.identity))) return;
    const call = await this.calls.findById(event.room);
    if (!call || call.status === 'ended') return;
    const conversation = await this.conversations.findById(call.conversationId);
    if (!conversation) return;

    if (event.type === 'room_finished') {
      await this.finish(call, conversation, call.status === 'active' ? 'completed' : 'cancelled');
      return;
    }
    // Solo cuenta si esa identidad estaba ADENTRO de esta llamada (no se aceptan identidades ajenas).
    if ((await this.calls.getParticipantState(call.id, event.identity)) !== 'joined') return;
    await this.calls.setParticipantState(call.id, event.identity, 'left', new Date());
    if (conversation.type === 'direct') await this.finish(call, conversation, call.status === 'active' ? 'completed' : 'cancelled');
    else await this.settleGroup(call, conversation);
  }

  /** En un grupo: la llamada termina cuando no queda nadie adentro ni nadie por atender. */
  private async settleGroup(call: CallRow, conversation: ConversationRow): Promise<CallDto> {
    const joined = await this.calls.countJoined(call.id);
    const invited = call.status === 'ringing' ? await this.calls.countInvited(call.id) : 0;
    if (joined === 0) return this.finish(call, conversation, call.status === 'active' ? 'completed' : 'cancelled');
    // Solo quedó quien llamó y ya nadie más puede atender: nadie la tomó.
    if (call.status === 'ringing' && invited === 0) return this.finish(call, conversation, 'declined');
    return this.publishUpdate(call, conversation);
  }

  private async finish(call: CallRow, conversation: ConversationRow, reason: EndReason, now = new Date()): Promise<CallDto> {
    const ended = await this.calls.end(call.id, reason, now);
    if (!ended) {
      // Otro pedido la terminó al mismo tiempo: se devuelve el estado final sin avisar dos veces.
      const latest = (await this.calls.findById(call.id)) ?? call;
      return this.toDto(latest, conversation);
    }
    await this.media.closeRoom(call.id);
    const dto = await this.publishUpdate(ended, conversation);
    await this.chats.postCallLog(ended);
    // Quienes nunca atendieron: se cierra el aviso de "llamada entrante" (y queda como perdida).
    const unanswered = dto.participants.filter((participant) => participant.state === 'invited').map((participant) => participant.user.id);
    void this.notifyClosed(ended, conversation, unanswered, reason === 'missed' || reason === 'cancelled');
    return dto;
  }

  /** Avisa a TODOS los miembros actuales de la conversación (así se apaga el timbre en todos lados). */
  private async publishUpdate(call: CallRow, conversation: ConversationRow): Promise<CallDto> {
    const dto = await this.toDto(call, conversation);
    const members = await this.conversations.getMembers([conversation.id]);
    this.realtime.toUsers(
      members.map((member) => member.user.id),
      'call:updated',
      dto,
    );
    return dto;
  }

  /** Título del aviso: el grupo, o quien llama. Nunca incluye mensajes. */
  private pushInfo(call: CallRow, conversation: ConversationRow, members: MemberWithUser[]) {
    const caller = members.find((member) => member.user.id === call.startedBy)?.user.displayName ?? 'Alguien';
    return {
      callId: call.id,
      conversationId: call.conversationId,
      kind: call.kind,
      title: conversation.type === 'group' ? `${caller} · ${conversation.title ?? 'Grupo'}` : caller,
      group: conversation.type === 'group',
    };
  }

  private async notifyClosed(call: CallRow, conversation: ConversationRow, userIds: string[], missed: boolean): Promise<void> {
    if (userIds.length === 0) return;
    const { group: _group, ...info } = this.pushInfo(call, conversation, await this.conversations.getMembers([conversation.id]));
    const payload: PushPayload = { type: 'call-closed', ...info, missed };
    // Mismo "tema" que el aviso de llamada: el servicio de push reemplaza uno por otro.
    await this.push.notify(userIds, payload, { ttl: missed ? 24 * 60 * 60 : 60, urgency: missed ? 'normal' : 'high', topic: pushTopic(call) });
  }

  private async toDto(call: CallRow, conversation: ConversationRow): Promise<CallDto> {
    const participants = await this.calls.getParticipants([call.id]);
    return {
      id: call.id,
      conversationId: call.conversationId,
      conversationType: conversation.type,
      title: conversation.title,
      kind: call.kind,
      status: call.status,
      startedBy: call.startedBy,
      participants: participants.map((row: ParticipantWithUser) => ({
        user: row.user.isPrivate ? toLimitedUser(row.user) : toPublicUser(row.user),
        state: row.state,
      })),
      createdAt: call.createdAt.toISOString(),
      answeredAt: call.answeredAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      endReason: call.endReason,
    };
  }

  private async tokenFor(call: CallRow, userId: string): Promise<string> {
    const members = await this.conversations.getMembers([call.conversationId]);
    const me = members.find((member) => member.user.id === userId);
    if (!me) throw new NotFoundException(NOT_FOUND);
    return this.media.createJoinToken({ room: call.id, identity: userId, name: me.user.displayName, kind: call.kind });
  }

  private assertAvailable(): void {
    if (!this.media.isAvailable()) {
      throw new ServiceUnavailableException({ code: 'CALLS_UNAVAILABLE', message: 'Las llamadas no están disponibles en este momento' });
    }
  }

  private async requireMembership(userId: string, conversationId: string): Promise<ConversationRow> {
    const conversation = await this.conversations.findById(conversationId);
    if (!conversation || !(await this.conversations.getMemberRole(conversationId, userId))) throw new NotFoundException(CHAT_NOT_FOUND);
    return conversation;
  }

  /** La llamada existe Y quien la pide es miembro ACTUAL de su conversación; si no, "no encontrada". */
  private async requireCall(userId: string, callId: string): Promise<{ call: CallRow; conversation: ConversationRow }> {
    const call = await this.calls.findById(callId);
    if (!call) throw new NotFoundException(NOT_FOUND);
    const conversation = await this.conversations.findById(call.conversationId);
    if (!conversation || !(await this.conversations.getMemberRole(call.conversationId, userId))) throw new NotFoundException(NOT_FOUND);
    return { call, conversation };
  }
}
