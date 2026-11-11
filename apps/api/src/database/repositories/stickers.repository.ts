import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { DB, type Database } from '../database.types';
import { stickers, type StickerRow } from '../schema';

@Injectable()
export class StickersRepository {
  constructor(@Inject(DB) private readonly db: Database) {}

  async create(id: string, ownerId: string, storageKey: string): Promise<StickerRow> {
    const [row] = await this.db.insert(stickers).values({ id, ownerId, storageKey }).returning();
    if (!row) throw new Error('No se pudo guardar el sticker');
    return row;
  }

  listByOwner(ownerId: string): Promise<StickerRow[]> {
    return this.db.select().from(stickers).where(eq(stickers.ownerId, ownerId)).orderBy(desc(stickers.createdAt));
  }

  async countByOwner(ownerId: string): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(stickers).where(eq(stickers.ownerId, ownerId));
    return row?.total ?? 0;
  }

  /** Busca un sticker SOLO si pertenece a esa persona (la autorización va en la propia consulta). */
  async findOwned(id: string, ownerId: string): Promise<StickerRow | undefined> {
    const [row] = await this.db
      .select()
      .from(stickers)
      .where(and(eq(stickers.id, id), eq(stickers.ownerId, ownerId)))
      .limit(1);
    return row;
  }

  /** Borra un sticker propio y devuelve su clave de almacenamiento (para borrar el archivo). */
  async deleteOwned(id: string, ownerId: string): Promise<string | undefined> {
    const [row] = await this.db
      .delete(stickers)
      .where(and(eq(stickers.id, id), eq(stickers.ownerId, ownerId)))
      .returning({ storageKey: stickers.storageKey });
    return row?.storageKey;
  }
}
