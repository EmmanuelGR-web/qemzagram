import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { users, type NewUserRow, type UserRow } from '../schema';

export type UserPatch = Partial<
  Pick<
    UserRow,
    | 'displayName'
    | 'bio'
    | 'avatarUrl'
    | 'coverUrl'
    | 'isPrivate'
    | 'status'
    | 'passwordHash'
    | 'emailVerifiedAt'
    | 'failedLogins'
    | 'lockedUntil'
    | 'email'
    | 'tag'
  >
>;

@Injectable()
export class UsersRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  }

  async findByTag(tag: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.tag, tag)).limit(1);
    return row;
  }

  async findManyByTags(tags: string[]): Promise<UserRow[]> {
    if (tags.length === 0) return [];
    return this.db.select().from(users).where(inArray(users.tag, tags));
  }

  async findManyByIds(ids: string[]): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(users).where(inArray(users.id, ids));
  }

  async create(values: NewUserRow): Promise<UserRow> {
    const [row] = await this.db.insert(users).values(values).returning();
    if (!row) throw new Error('No se pudo crear el usuario');
    return row;
  }

  async update(id: string, patch: UserPatch): Promise<UserRow | undefined> {
    const [row] = await this.db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return row;
  }
}
