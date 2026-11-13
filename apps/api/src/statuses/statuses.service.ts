import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  STATUS_ACTIVE_MAX,
  STATUS_BACKGROUNDS,
  STATUS_TTL_HOURS,
  STATUS_VIDEO_MAX_SECONDS,
  type CreateMediaStatusInput,
  type CreateTextStatusInput,
  type StatusBackground,
  type StatusDto,
  type StatusFeedItemDto,
  type StatusOverviewDto,
} from '@qemzagram/shared';
import { randomUUID } from 'node:crypto';
import { CryptoService } from '../common/crypto.service';
import { toLimitedUser, toPublicUser } from '../common/mappers';
import { StatusesRepository } from '../database/repositories/statuses.repository';
import type { StatusRow } from '../database/schema';
import { MediaProcessor, type UploadedInput } from '../media/media-processor.service';
import { MediaUrlService } from '../media/media-url.service';
import { MediaService, type ServedFile } from '../media/media.service';
import { BlobStorage } from '../storage/blob-storage.port';

const TTL_MS = STATUS_TTL_HOURS * 60 * 60 * 1000;
const UNAVAILABLE_BODY = '[Estado no disponible]';
const NOT_FOUND = { code: 'STATUS_NOT_FOUND', message: 'No encontramos ese estado' };

/** AAD del texto cifrado: lo ata a ESTE estado (copiarlo a otra fila lo invalida). */
export const statusAad = (id: string) => `status:${id}`;

/**
 * Estados de 24 horas: publicar y listar los propios y los de la agenda.
 * La visibilidad se resuelve en el repositorio (dentro de la propia consulta SQL).
 */
@Injectable()
export class StatusesService {
  constructor(
    private readonly statuses: StatusesRepository,
    private readonly crypto: CryptoService,
    private readonly processor: MediaProcessor,
    private readonly media: MediaService,
    private readonly urls: MediaUrlService,
    private readonly storage: BlobStorage,
  ) {}

  async overview(viewerId: string, now = new Date()): Promise<StatusOverviewDto> {
    const [mine, feedRows] = await Promise.all([this.statuses.listActiveByOwner(viewerId, now), this.statuses.listFeed(viewerId, now)]);

    // Agrupa por persona conservando el orden cronológico dentro de cada grupo.
    const groups = new Map<string, StatusFeedItemDto>();
    for (const { status, owner } of feedRows) {
      const group = groups.get(owner.id) ?? { user: owner.isPrivate ? toLimitedUser(owner) : toPublicUser(owner), statuses: [] };
      group.statuses.push(this.toDto(status));
      groups.set(owner.id, group);
    }
    // Primero quien publicó más recientemente.
    const feed = [...groups.values()].sort((a, b) => (b.statuses.at(-1)?.createdAt ?? '').localeCompare(a.statuses.at(-1)?.createdAt ?? ''));
    return { mine: mine.map((row) => this.toDto(row)), feed };
  }

  async createText(userId: string, input: CreateTextStatusInput): Promise<StatusDto> {
    const now = new Date();
    await this.assertQuota(userId, now);
    const id = randomUUID();
    const row = await this.statuses.create({
      id,
      ownerId: userId,
      kind: 'text',
      bodyEncrypted: this.crypto.encryptText(input.body.trim(), statusAad(id)),
      background: input.background,
      createdAt: now,
      expiresAt: new Date(now.getTime() + TTL_MS),
    });
    return this.toDto(row);
  }

  /**
   * Estado con foto o video: pasa por el MISMO pipeline que los adjuntos del chat
   * (tipo real → antivirus → re-codificación sin metadatos) y se guarda cifrado.
   */
  async createMedia(userId: string, input: CreateMediaStatusInput, file: UploadedInput): Promise<StatusDto> {
    const now = new Date();
    await this.assertQuota(userId, now);
    const processed = await this.processor.process(input.kind, file, userId, { videoMaxSeconds: STATUS_VIDEO_MAX_SECONDS });
    const id = randomUUID();
    const storageKey = randomUUID();
    await this.storage.put(storageKey, this.crypto.encryptBlob(processed.data, statusAad(id)));
    try {
      const row = await this.statuses.create({
        id,
        ownerId: userId,
        kind: input.kind,
        bodyEncrypted: this.crypto.encryptText(input.caption.trim(), statusAad(id)),
        storageKey,
        mimeType: processed.mimeType,
        sizeBytes: processed.data.length,
        width: processed.width,
        height: processed.height,
        durationMs: processed.durationMs,
        createdAt: now,
        expiresAt: new Date(now.getTime() + TTL_MS),
      });
      return this.toDto(row);
    } catch (error) {
      // Si la base falla, no queda un archivo huérfano.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Sirve la foto/video de un estado SOLO si la firma es válida y vigente, el estado no venció
   * y quien lo pide puede verlo HOY (si lo sacaron de la audiencia, deja de verlo al instante).
   */
  async getMediaForViewer(viewerId: string, id: string, exp: number, sig: string): Promise<ServedFile> {
    if (!this.urls.verify('e', id, exp, sig)) throw new NotFoundException(NOT_FOUND);
    const row = await this.statuses.findVisible(id, viewerId, new Date());
    if (!row?.storageKey || !row.mimeType) throw new NotFoundException(NOT_FOUND);
    const data = await this.media.readBlob(row.storageKey, statusAad(row.id));
    return { data, mimeType: row.mimeType, disposition: 'inline', fileName: `estado-${row.id.slice(0, 8)}` };
  }

  toDto(row: StatusRow): StatusDto {
    return {
      id: row.id,
      ownerId: row.ownerId,
      kind: row.kind,
      body: this.decryptBody(row),
      background: isBackground(row.background) ? row.background : null,
      media:
        row.storageKey && row.mimeType
          ? { url: this.urls.sign('e', row.id).url, mimeType: row.mimeType, width: row.width, height: row.height, durationMs: row.durationMs }
          : null,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  private async assertQuota(userId: string, now: Date): Promise<void> {
    if ((await this.statuses.countActive(userId, now)) >= STATUS_ACTIVE_MAX) {
      throw new BadRequestException({ code: 'STATUS_LIMIT', message: `Podés tener hasta ${STATUS_ACTIVE_MAX} estados al mismo tiempo` });
    }
  }

  private decryptBody(row: StatusRow): string {
    try {
      return this.crypto.decryptText(row.bodyEncrypted, statusAad(row.id));
    } catch {
      return UNAVAILABLE_BODY;
    }
  }
}

function isBackground(value: string | null): value is StatusBackground {
  return value !== null && (STATUS_BACKGROUNDS as readonly string[]).includes(value);
}
