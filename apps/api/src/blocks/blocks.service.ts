import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BLOCKS_MAX, type BlockedUserDto } from '@qemzagram/shared';
import { AuditService } from '../common/audit.service';
import { toLimitedUser } from '../common/mappers';
import { BlocksRepository } from '../database/repositories/blocks.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { UserRow } from '../database/schema';

export const USER_NOT_FOUND = { code: 'USER_NOT_FOUND', message: 'No encontramos ese tag' };

/**
 * Bloqueo total entre dos personas. Reglas:
 * - Para quien FUE bloqueado, quien lo bloqueó "no existe" (mismo error que un tag inexistente).
 * - Quien bloqueó recibe un aviso claro ("desbloqueá primero").
 * - Nunca se le informa a nadie que fue bloqueado.
 */
@Injectable()
export class BlocksService {
  constructor(
    private readonly blocks: BlocksRepository,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<BlockedUserDto[]> {
    const rows = await this.blocks.listWithUsers(userId);
    return rows
      .filter((row) => row.user.status !== 'deleted')
      .map((row) => ({ user: toLimitedUser(row.user), blockedAt: row.createdAt.toISOString() }));
  }

  async block(userId: string, targetId: string): Promise<void> {
    if (targetId === userId) throw new BadRequestException({ code: 'CANNOT_BLOCK_SELF', message: 'No podés bloquearte a vos mismo' });
    const target = await this.users.findById(targetId);
    if (!target || target.status === 'deleted') throw new NotFoundException(USER_NOT_FOUND);
    if ((await this.blocks.count(userId)) >= BLOCKS_MAX && !(await this.blocks.blockedAmong(userId, [targetId])).has(targetId)) {
      throw new ConflictException({ code: 'BLOCKS_LIMIT', message: `Podés bloquear hasta ${BLOCKS_MAX} personas` });
    }
    await this.blocks.block(userId, targetId);
    await this.audit.log('user.blocked', { userId, meta: { targetId } });
  }

  async unblock(userId: string, targetId: string): Promise<void> {
    if (!(await this.blocks.unblock(userId, targetId))) {
      throw new NotFoundException({ code: 'NOT_BLOCKED', message: 'No tenés bloqueada a esa persona' });
    }
    await this.audit.log('user.unblocked', { userId, meta: { targetId } });
  }

  /**
   * Verifica que `userId` pueda interactuar con `target` (agregarlo, abrir un chat, sumarlo a un grupo…).
   * Si `target` lo bloqueó: "no encontrado". Si lo bloqueó `userId`: le pide desbloquear.
   */
  async assertCanReach(userId: string, target: UserRow): Promise<void> {
    if ((await this.blocks.blockersAmong(userId, [target.id])).has(target.id)) throw new NotFoundException(USER_NOT_FOUND);
    if ((await this.blocks.blockedAmong(userId, [target.id])).has(target.id)) {
      throw new ConflictException({ code: 'USER_BLOCKED', message: `Bloqueaste a @${target.tag}. Desbloqueala primero desde su perfil o Ajustes.` });
    }
  }

  async hasBlockedMe(userId: string, otherId: string): Promise<boolean> {
    return (await this.blocks.blockersAmong(userId, [otherId])).has(otherId);
  }

  async isBlockedEither(userId: string, otherId: string): Promise<boolean> {
    return (await this.blocks.blockedEitherAmong(userId, [otherId])).has(otherId);
  }

  blockedEitherAmong(userId: string, others: string[]): Promise<Set<string>> {
    return this.blocks.blockedEitherAmong(userId, others);
  }

  blockedByMeAmong(userId: string, others: string[]): Promise<Set<string>> {
    return this.blocks.blockedAmong(userId, others);
  }

  blockersAmong(userId: string, others: string[]): Promise<Set<string>> {
    return this.blocks.blockersAmong(userId, others);
  }

  removeAllFor(userId: string): Promise<void> {
    return this.blocks.removeAllFor(userId);
  }
}
