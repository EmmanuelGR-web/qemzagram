import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ConversationKeysDto, E2eeKeyDto, E2eePublishKeyInput, MyE2eeKeyDto } from '@qemzagram/shared';
import { createPublicKey } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { ConversationsRepository } from '../database/repositories/conversations.repository';
import { E2eeKeysRepository } from '../database/repositories/e2ee-keys.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { E2eeKeyRow } from '../database/schema';
import { MailPort } from '../mail/mail.port';

const NOT_FOUND = { code: 'CHAT_NOT_FOUND', message: 'No encontramos esa conversación' };
const KEY_EXISTS = { code: 'E2EE_KEY_EXISTS', message: 'Tu cuenta ya tiene claves de cifrado' };

export function toKeyDto(row: E2eeKeyRow): E2eeKeyDto {
  return { id: row.id, userId: row.userId, publicKey: row.publicKey, createdAt: row.createdAt.toISOString(), active: row.revokedAt === null };
}

/**
 * Claves de cifrado de extremo a extremo. El servidor es solo un "directorio": guarda claves
 * públicas y copias cifradas que no puede abrir. Nunca ve claves privadas ni el código de recuperación.
 */
@Injectable()
export class E2eeService {
  constructor(
    private readonly keys: E2eeKeysRepository,
    private readonly conversations: ConversationsRepository,
    private readonly users: UsersRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly mail: MailPort,
  ) {}

  async mine(userId: string): Promise<MyE2eeKeyDto> {
    const row = await this.keys.findActive(userId);
    return { key: row ? toKeyDto(row) : null, backup: row?.backup ?? null };
  }

  async publish(userId: string, input: E2eePublishKeyInput): Promise<MyE2eeKeyDto> {
    assertValidPoint(input.publicKey);
    const values = { userId, publicKey: input.publicKey, backup: input.backup };
    const current = await this.keys.findActive(userId);
    if (!current) {
      const created = await this.keys.createFirst(values);
      // Otra pestaña la creó al mismo tiempo: no se pisa sin contraseña.
      if (!created) throw new ConflictException(KEY_EXISTS);
      await this.audit.log('e2ee.key_created', { userId, meta: { keyId: created.id } });
      return { key: toKeyDto(created), backup: created.backup };
    }
    if (!input.password) throw new ConflictException(KEY_EXISTS);
    const user = await this.users.findById(userId);
    if (!user || !(await this.crypto.verifyPassword(user.passwordHash, input.password))) {
      throw new ForbiddenException({ code: 'INVALID_PASSWORD', message: 'La contraseña es incorrecta' });
    }
    const replaced = await this.keys.replace(values);
    await this.audit.log('e2ee.key_reset', { userId, meta: { keyId: replaced.id, previousKeyId: current.id } });
    await this.mail.sendSecurityAlert(user.email, user.displayName, 'e2ee_key_reset');
    return { key: toKeyDto(replaced), backup: replaced.backup };
  }

  /** Claves activas de los miembros ACTUALES y activos (para cifrar). Solo para miembros de la conversación. */
  async conversationKeys(userId: string, conversationId: string): Promise<ConversationKeysDto> {
    if (!(await this.conversations.getMemberRole(conversationId, userId))) throw new NotFoundException(NOT_FOUND);
    // Una cuenta dada de baja o suspendida no recibe mensajes cifrados nuevos: ni siquiera figura.
    const members = (await this.conversations.getMembers([conversationId])).filter((member) => member.user.status === 'active');
    const active = await this.keys.activeForUsers(members.map((member) => member.user.id));
    const byUser = new Map(active.map((row) => [row.userId, row]));
    return {
      members: members.map((member) => {
        const row = byUser.get(member.user.id);
        return { userId: member.user.id, key: row ? toKeyDto(row) : null };
      }),
    };
  }

  /** Claves (también las reemplazadas) para verificar mensajes. Solo de personas con las que compartís o compartiste un chat. */
  async lookup(viewerId: string, ids: string[]): Promise<E2eeKeyDto[]> {
    const rows = await this.keys.findManyByIds(ids);
    const visible = await this.keys.ownersVisibleTo(
      viewerId,
      rows.map((row) => row.userId).filter((ownerId) => ownerId !== viewerId),
    );
    return rows.filter((row) => row.userId === viewerId || visible.has(row.userId)).map(toKeyDto);
  }

  /**
   * Claves activas por miembro actual (las cuentas no activas no cuentan).
   * Si TODOS los miembros activos tienen clave, el chat es de extremo a extremo.
   */
  async activeKeysByMember(conversationId: string): Promise<{ keys: Map<string, string>; complete: boolean }> {
    const members = (await this.conversations.getMembers([conversationId])).filter((member) => member.user.status === 'active');
    const active = await this.keys.activeForUsers(members.map((member) => member.user.id));
    const keys = new Map(active.map((row) => [row.userId, row.id]));
    return { keys, complete: members.every((member) => keys.has(member.user.id)) };
  }

  async removeAllFor(userId: string): Promise<void> {
    await this.keys.revokeAllForUser(userId);
  }
}

/** Rechaza coordenadas que no son un punto válido de la curva P-256. */
function assertValidPoint(jwk: E2eePublishKeyInput['publicKey']): void {
  try {
    createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: 'jwk' });
  } catch {
    throw new BadRequestException({ code: 'INVALID_KEY', message: 'La clave pública no es válida' });
  }
}
