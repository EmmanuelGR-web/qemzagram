import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import {
  CONTACTS_MAX,
  NEARBY_GREETING_HOURS,
  NEARBY_GREETINGS_PER_DAY,
  type ContactDto,
  type NearbyGreetResultDto,
  type NearbyGreetingDto,
  type NearbyGreetingsDto,
  type NearbyUserDto,
} from '@qemzagram/shared';
import { BlocksService } from '../blocks/blocks.service';
import { toPublicUser } from '../common/mappers';
import { ContactsRepository } from '../database/repositories/contacts.repository';
import { GreetingsRepository, type GreetingWithUser } from '../database/repositories/greetings.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { NearbyGreetingRow, UserRow } from '../database/schema';
import { RealtimePublisher } from '../realtime/realtime.port';
import { NearbyService } from './nearby.service';

const NOT_NEARBY = { code: 'NEARBY_USER_NOT_FOUND', message: 'Esa persona ya no está cerca' };
const GREETING_NOT_FOUND = { code: 'GREETING_NOT_FOUND', message: 'Ese saludo ya no está disponible' };

/**
 * Saludos entre personas cercanas. Reglas:
 * - Solo se saluda a quien aparece AHORA en tu lista de cercanos (no sirve para escribirle a cualquiera).
 * - 20 saludos por día; un saludo sin respuesta vence a las 24 h.
 * - Al aceptar, las dos personas quedan en la agenda de la otra (y recién ahí ven el tag).
 * - El rechazo NUNCA se informa: para quien saludó, el saludo simplemente vence.
 */
@Injectable()
export class GreetingsService {
  constructor(
    private readonly greetings: GreetingsRepository,
    private readonly contacts: ContactsRepository,
    private readonly users: UsersRepository,
    private readonly nearby: NearbyService,
    private readonly blocks: BlocksService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(userId: string, now = new Date()): Promise<NearbyGreetingsDto> {
    const since = cutoff(now);
    const [received, sent] = await Promise.all([this.greetings.listReceived(userId, since), this.greetings.listSent(userId, since)]);
    return { received: received.map(toGreetingDto), sent: sent.map(toGreetingDto) };
  }

  async greet(userId: string, targetId: string, now = new Date()): Promise<NearbyGreetResultDto> {
    if (targetId === userId) throw new BadRequestException({ code: 'CANNOT_GREET_SELF', message: 'No podés saludarte a vos mismo' });
    const target = await this.nearby.findNearby(userId, targetId, now);
    if (!target) throw new NotFoundException(NOT_NEARBY);
    if ((await this.contacts.mutualAmong(userId, [targetId])).has(targetId)) {
      throw new ConflictException({ code: 'ALREADY_CONNECTED', message: 'Ya están conectados: buscala en tu agenda' });
    }

    // Si la otra persona ya me había saludado, saludar es aceptar: quedan conectados.
    const since = cutoff(now);
    const reverse = await this.greetings.findPair(targetId, userId);
    if (reverse && reverse.status === 'pending' && reverse.createdAt > since) {
      const contact = await this.connect(reverse, userId, now);
      return { state: 'connected', contact };
    }

    const mine = await this.greetings.findPair(userId, targetId);
    if (mine && mine.status !== 'accepted' && mine.createdAt > since) {
      // Pendiente o rechazado (sin vencer): se responde igual que si estuviera pendiente.
      throw new ConflictException({ code: 'GREETING_ALREADY_SENT', message: 'Ya le mandaste un saludo' });
    }
    if ((await this.greetings.countSentSince(userId, since)) >= NEARBY_GREETINGS_PER_DAY) {
      throw new HttpException({ code: 'GREETINGS_DAILY_LIMIT', message: 'Llegaste al máximo de saludos por hoy' }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const greeting = await this.greetings.upsertPending(userId, targetId, now);
    const me = await this.users.findById(userId);
    if (me) this.realtime.toUsers([targetId], 'nearby:greeting', { id: greeting.id, user: toNearbyUser(me), createdAt: greeting.createdAt.toISOString() });
    return { state: 'sent', contact: null };
  }

  /** Aceptar un saludo recibido: las dos personas quedan en la agenda de la otra. */
  async accept(userId: string, greetingId: string, now = new Date()): Promise<ContactDto> {
    const greeting = await this.greetings.findById(greetingId);
    if (!greeting || greeting.toId !== userId || greeting.status !== 'pending' || greeting.createdAt <= cutoff(now)) {
      throw new NotFoundException(GREETING_NOT_FOUND);
    }
    return this.connect(greeting, userId, now);
  }

  async decline(userId: string, greetingId: string, now = new Date()): Promise<void> {
    if (!(await this.greetings.decline(greetingId, userId, cutoff(now), now))) throw new NotFoundException(GREETING_NOT_FOUND);
  }

  removeAllFor(userId: string): Promise<void> {
    return this.greetings.removeAllFor(userId);
  }

  /** `greeting` fue enviado A `userId`. Verifica todo, conecta y le avisa a quien saludó. */
  private async connect(greeting: NearbyGreetingRow, userId: string, now: Date): Promise<ContactDto> {
    const sender = await this.users.findById(greeting.fromId);
    if (!sender || sender.status !== 'active' || (await this.blocks.isBlockedEither(userId, sender.id))) {
      throw new NotFoundException(GREETING_NOT_FOUND);
    }
    await this.assertRoom(userId, sender.id);
    await this.assertRoom(sender.id, userId);

    const accepted = await this.greetings.accept(greeting.id, userId, cutoff(now), now);
    if (!accepted) throw new NotFoundException(GREETING_NOT_FOUND);

    const me = await this.users.findById(userId);
    if (me) this.realtime.toUsers([sender.id], 'nearby:connected', toContact(me, now));
    return toContact(sender, now);
  }

  /** La agenda tiene un máximo: si alguna está llena no se conecta (mismo mensaje para las dos). */
  private async assertRoom(ownerId: string, otherId: string): Promise<void> {
    if ((await this.contacts.count(ownerId)) >= CONTACTS_MAX && !(await this.contacts.exists(ownerId, otherId))) {
      throw new ConflictException({ code: 'CONTACTS_LIMIT', message: 'No se pudo conectar: una de las agendas está llena' });
    }
  }
}

function cutoff(now: Date): Date {
  return new Date(now.getTime() - NEARBY_GREETING_HOURS * 60 * 60 * 1000);
}

function toNearbyUser(user: UserRow): NearbyUserDto {
  return { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl };
}

function toGreetingDto(row: GreetingWithUser): NearbyGreetingDto {
  return { id: row.greeting.id, user: toNearbyUser(row.user), createdAt: row.greeting.createdAt.toISOString() };
}

/** Ya conectados (agenda mutua): se ve el perfil completo. */
function toContact(user: UserRow, now: Date): ContactDto {
  return { user: toPublicUser(user), alias: null, addedAt: now.toISOString(), blocked: false };
}
