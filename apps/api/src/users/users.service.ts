import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PublicUser, SelfUser, UpdateProfileInput } from '@qemzagram/shared';
import { BlocksService, USER_NOT_FOUND } from '../blocks/blocks.service';
import { AuditService } from '../common/audit.service';
import { CryptoService } from '../common/crypto.service';
import { toLimitedUser, toPublicUser, toSelfUser } from '../common/mappers';
import { ContactsRepository } from '../database/repositories/contacts.repository';
import { SessionsRepository } from '../database/repositories/sessions.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import { GreetingsService } from '../nearby/greetings.service';
import { NearbyService } from '../nearby/nearby.service';
import { PushService } from '../notifications/push.service';
import { StatusesService } from '../statuses/statuses.service';
import type { ImageKind } from '../storage/storage.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly contacts: ContactsRepository,
    private readonly sessions: SessionsRepository,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly statuses: StatusesService,
    private readonly push: PushService,
    private readonly blocks: BlocksService,
    private readonly nearby: NearbyService,
    private readonly greetings: GreetingsService,
  ) {}

  async getMe(userId: string): Promise<SelfUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException();
    return toSelfUser(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<SelfUser> {
    const user = await this.users.update(userId, input);
    if (!user) throw new NotFoundException();
    await this.audit.log('profile.updated', { userId, meta: { fields: Object.keys(input) } });
    return toSelfUser(user);
  }

  async setImage(userId: string, kind: ImageKind, buffer: Buffer): Promise<SelfUser> {
    const current = await this.users.findById(userId);
    if (!current) throw new NotFoundException();
    const url = await this.storage.saveImage(buffer, kind);
    const updated = await this.users.update(userId, kind === 'avatar' ? { avatarUrl: url } : { coverUrl: url });
    await this.storage.remove(kind === 'avatar' ? current.avatarUrl : current.coverUrl);
    if (!updated) throw new NotFoundException();
    return toSelfUser(updated);
  }

  async removeImage(userId: string, kind: ImageKind): Promise<SelfUser> {
    const current = await this.users.findById(userId);
    if (!current) throw new NotFoundException();
    const updated = await this.users.update(userId, kind === 'avatar' ? { avatarUrl: null } : { coverUrl: null });
    await this.storage.remove(kind === 'avatar' ? current.avatarUrl : current.coverUrl);
    if (!updated) throw new NotFoundException();
    return toSelfUser(updated);
  }

  /**
   * Perfil de otra persona. Si la cuenta es privada, quien no esté en su agenda
   * solo ve el tag, el nombre y la foto de perfil. Si esa persona te bloqueó, para vos "no existe".
   */
  async getPublicProfile(viewerId: string, tag: string): Promise<PublicUser> {
    const target = await this.users.findByTag(tag);
    if (!target || target.status !== 'active') throw new NotFoundException(USER_NOT_FOUND);
    if (target.id === viewerId) return toPublicUser(target);
    if (await this.blocks.hasBlockedMe(viewerId, target.id)) throw new NotFoundException(USER_NOT_FOUND);
    if (!target.isPrivate) return toPublicUser(target);
    const hasAddedViewer = await this.contacts.exists(target.id, viewerId);
    return hasAddedViewer ? toPublicUser(target) : toLimitedUser(target);
  }

  /** Suspensión temporal: la cuenta queda oculta hasta que su dueño vuelva a iniciar sesión. */
  async pauseAccount(userId: string, password: string): Promise<void> {
    await this.assertPassword(userId, password);
    await this.users.update(userId, { status: 'paused' });
    await this.sessions.revokeAllForUser(userId);
    // Al pausar, deja de aparecer en "Personas cercanas" y se borra su zona.
    await this.nearby.hide(userId);
    await this.audit.log('account.paused', { userId });
  }

  /**
   * Baja definitiva: se anonimizan los datos personales (correo, nombre, fotos, bio) y se libera el tag.
   * Las sesiones se cierran y los datos no se pueden recuperar.
   */
  async deleteAccount(userId: string, password: string): Promise<void> {
    const user = await this.assertPassword(userId, password);
    await this.storage.remove(user.avatarUrl);
    await this.storage.remove(user.coverUrl);
    const suffix = userId.replace(/-/g, '').slice(0, 12);
    await this.users.update(userId, {
      status: 'deleted',
      email: `deleted+${suffix}@invalid.qemzagram`,
      tag: `eliminado_${suffix}`,
      displayName: 'Cuenta eliminada',
      bio: '',
      avatarUrl: null,
      coverUrl: null,
      passwordHash: await this.crypto.hashPassword(this.crypto.randomToken(32)),
    });
    await this.sessions.revokeAllForUser(userId);
    // Los estados (y sus archivos cifrados) se borran ya, sin esperar a que venzan.
    await this.statuses.removeAllFor(userId);
    await this.push.removeAllFor(userId);
    await this.blocks.removeAllFor(userId);
    await this.nearby.removeAllFor(userId);
    await this.greetings.removeAllFor(userId);
    await this.audit.log('account.deleted', { userId });
  }

  private async assertPassword(userId: string, password: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException();
    if (!(await this.crypto.verifyPassword(user.passwordHash, password))) {
      throw new ForbiddenException({ code: 'INVALID_PASSWORD', message: 'La contraseña es incorrecta' });
    }
    return user;
  }
}

export function requireFile(file: Express.Multer.File | undefined): Buffer {
  if (!file?.buffer?.length) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'Adjuntá una imagen' });
  return file.buffer;
}
