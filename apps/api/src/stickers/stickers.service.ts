import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CUSTOM_STICKERS_MAX, type StickerDto } from '@qemzagram/shared';
import { randomUUID } from 'node:crypto';
import { CryptoService } from '../common/crypto.service';
import { StickersRepository } from '../database/repositories/stickers.repository';
import { MediaProcessor } from '../media/media-processor.service';
import { MediaService } from '../media/media.service';
import { BlobStorage } from '../storage/blob-storage.port';

const NOT_FOUND = { code: 'STICKER_NOT_FOUND', message: 'No encontramos ese sticker' };

/** "Mis stickers": cada persona crea, ve y borra SOLO los suyos. */
@Injectable()
export class StickersService {
  private readonly logger = new Logger(StickersService.name);

  constructor(
    private readonly stickers: StickersRepository,
    private readonly processor: MediaProcessor,
    private readonly media: MediaService,
    private readonly storage: BlobStorage,
    private readonly crypto: CryptoService,
  ) {}

  async list(userId: string): Promise<StickerDto[]> {
    const rows = await this.stickers.listByOwner(userId);
    return rows.map((row) => this.media.toStickerDto(row));
  }

  async create(userId: string, image: Buffer): Promise<StickerDto> {
    if ((await this.stickers.countByOwner(userId)) >= CUSTOM_STICKERS_MAX) {
      throw new BadRequestException({ code: 'STICKER_LIMIT', message: `Podés tener hasta ${CUSTOM_STICKERS_MAX} stickers propios` });
    }
    const processed = await this.processor.processSticker(image, userId);
    const id = randomUUID();
    const storageKey = randomUUID();
    await this.storage.put(storageKey, this.crypto.encryptBlob(processed.data, id));
    try {
      return this.media.toStickerDto(await this.stickers.create(id, userId, storageKey));
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async remove(userId: string, id: string): Promise<void> {
    const storageKey = await this.stickers.deleteOwned(id, userId);
    if (!storageKey) throw new NotFoundException(NOT_FOUND);
    await this.storage.delete(storageKey).catch((error: Error) => this.logger.error(`No se pudo borrar un sticker: ${error.message}`));
  }

  /** Imagen (descifrada) de un sticker propio, para enviarla como copia a un chat. */
  async readOwned(userId: string, id: string): Promise<Buffer> {
    const row = await this.stickers.findOwned(id, userId);
    if (!row) throw new NotFoundException(NOT_FOUND);
    return this.media.readBlob(row.storageKey, row.id);
  }
}
