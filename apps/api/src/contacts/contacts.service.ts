import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CONTACTS_MAX, type ContactDto } from '@qemzagram/shared';
import { BlocksService, USER_NOT_FOUND } from '../blocks/blocks.service';
import { toLimitedUser, toPublicUser } from '../common/mappers';
import { ContactsRepository } from '../database/repositories/contacts.repository';
import { UsersRepository } from '../database/repositories/users.repository';

@Injectable()
export class ContactsService {
  constructor(
    private readonly contacts: ContactsRepository,
    private readonly users: UsersRepository,
    private readonly blocks: BlocksService,
  ) {}

  async list(ownerId: string): Promise<ContactDto[]> {
    const rows = await this.contacts.listWithUsers(ownerId);
    const blocked = await this.blocks.blockedByMeAmong(
      ownerId,
      rows.map((row) => row.user.id),
    );
    return rows.map((row) => ({
      user: row.user.isPrivate ? toLimitedUser(row.user) : toPublicUser(row.user),
      alias: row.alias,
      addedAt: row.createdAt.toISOString(),
      blocked: blocked.has(row.user.id),
    }));
  }

  /** Agrega a alguien a la agenda a partir de su tag. */
  async add(ownerId: string, tag: string, alias?: string): Promise<ContactDto> {
    const target = await this.users.findByTag(tag);
    if (!target || target.status !== 'active') {
      throw new NotFoundException(USER_NOT_FOUND);
    }
    if (target.id === ownerId) {
      throw new BadRequestException({ code: 'CANNOT_ADD_SELF', message: 'No podés agregarte a vos mismo' });
    }
    await this.blocks.assertCanReach(ownerId, target);
    if ((await this.contacts.count(ownerId)) >= CONTACTS_MAX && !(await this.contacts.exists(ownerId, target.id))) {
      throw new ConflictException({ code: 'CONTACTS_LIMIT', message: `Tu agenda admite hasta ${CONTACTS_MAX} contactos` });
    }
    await this.contacts.add(ownerId, target.id, alias?.length ? alias : null);
    return {
      user: target.isPrivate ? toLimitedUser(target) : toPublicUser(target),
      alias: alias?.length ? alias : null,
      addedAt: new Date().toISOString(),
      blocked: false,
    };
  }

  async remove(ownerId: string, contactId: string): Promise<void> {
    if (!(await this.contacts.remove(ownerId, contactId))) {
      throw new NotFoundException({ code: 'CONTACT_NOT_FOUND', message: 'Ese contacto no está en tu agenda' });
    }
  }
}
