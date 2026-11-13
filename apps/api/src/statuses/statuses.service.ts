import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  type StatusPrivacyDto,
  type StatusViewDto,
  type UpdateStatusPrivacyInput,
} from '@qemzagram/shared';
import { randomUUID } from 'node:crypto';
import { CryptoService } from '../common/crypto.service';
import { toLimitedUser, toPublicUser } from '../common/mappers';
import { ContactsRepository } from '../database/repositories/contacts.repository';
import { StatusesRepository } from '../database/repositories/statuses.repository';
import type { StatusRow, UserRow } from '../database/schema';
import { MediaProcessor, type UploadedInput } from '../media/media-processor.service';
import { MediaUrlService } from '../media/media-url.service';
import { MediaService, type ServedFile } from '../media/media.service';
import { RealtimePublisher } from '../realtime/realtime.port';
import { BlobStorage } from '../storage/blob-storage.port';

const TTL_MS = STATUS_TTL_HOURS * 60 * 60 * 1000;
const UNAVAILABLE_BODY = '[Estado no disponible]';
const NOT_FOUND = { code: 'STATUS_NOT_FOUND', message: 'No encontramos ese estado' };

/** AAD del texto cifrado: lo ata a ESTE estado (copiarlo a otra fila lo invalida). */
export const statusAad = (id: string) => `status:${id}`;

/** Datos extra para armar el DTO: si quien mira ya lo vio, y cuántas vistas tiene (solo para el dueño). */
interface DtoContext {
  viewed: boolean;
  viewCount: number | null;
}

/**
 * Estados de 24 horas: publicar, ver, "visto por", borrar y privacidad.
 * La visibilidad se resuelve en el repositorio (dentro de la propia consulta SQL).
 */
@Injectable()
export class StatusesService {
  private readonly logger = new Logger(StatusesService.name);

  constructor(
    private readonly statuses: StatusesRepository,
    private readonly contacts: ContactsRepository,
    private readonly crypto: CryptoService,
    private readonly processor: MediaProcessor,
    private readonly media: MediaService,
    private readonly urls: MediaUrlService,
    private readonly storage: BlobStorage,
    private readonly realtime: RealtimePublisher,
  ) {}

  async overview(viewerId: string, now = new Date()): Promise<StatusOverviewDto> {
    const [mine, feedRows] = await Promise.all([this.statuses.listActiveByOwner(viewerId, now), this.statuses.listFeed(viewerId, now)]);
    const [counts, viewed] = await Promise.all([
      this.statuses.viewCounts(mine.map((row) => row.id)),
      this.statuses.viewedIds(
        viewerId,
        feedRows.map((row) => row.status.id),
      ),
    ]);

    // Agrupa por persona conservando el orden cronológico dentro de cada grupo.
    const groups = new Map<string, StatusFeedItemDto>();
    for (const { status, owner } of feedRows) {
      const group = groups.get(owner.id) ?? { user: toVisibleUser(owner), statuses: [], allViewed: true };
      const dto = this.toDto(status, { viewed: viewed.has(status.id), viewCount: null });
      group.statuses.push(dto);
      group.allViewed &&= dto.viewed;
      groups.set(owner.id, group);
    }
    // Primero lo que falta ver; dentro de cada grupo, quien publicó más recientemente.
    const latest = (item: StatusFeedItemDto) => item.statuses.at(-1)?.createdAt ?? '';
    const feed = [...groups.values()].sort((a, b) => Number(a.allViewed) - Number(b.allViewed) || latest(b).localeCompare(latest(a)));
    return { mine: mine.map((row) => this.toOwnDto(row, counts)), feed };
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
    await this.notifyAudience(userId);
    return this.toOwnDto(row);
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
    let row: StatusRow;
    try {
      row = await this.statuses.create({
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
    } catch (error) {
      // Si la base falla, no queda un archivo huérfano.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
    await this.notifyAudience(userId);
    return this.toOwnDto(row);
  }

  /** Borra un estado propio antes de que venza (con su archivo y sus vistas). */
  async remove(userId: string, id: string): Promise<void> {
    const deleted = await this.statuses.deleteOwned(id, userId);
    if (!deleted) throw new NotFoundException(NOT_FOUND);
    if (deleted.storageKey) await this.deleteBlob(deleted.storageKey);
    await this.notifyAudience(userId);
  }

  /** Borra TODOS los estados de una persona (baja de cuenta). No avisa: la cuenta ya no existe. */
  async removeAllFor(userId: string): Promise<void> {
    const keys = await this.statuses.deleteAllForOwner(userId);
    await Promise.all(keys.map((key) => this.deleteBlob(key)));
  }

  /**
   * Marca un estado como visto. Solo si quien lo pide puede verlo; si no, "no encontrado".
   * Ver los propios no cuenta.
   */
  async markViewed(viewerId: string, id: string): Promise<void> {
    const row = await this.statuses.findVisible(id, viewerId, new Date());
    if (!row) throw new NotFoundException(NOT_FOUND);
    if (row.ownerId !== viewerId) await this.statuses.markViewed(id, viewerId);
  }

  /** "Visto por": SOLO el dueño del estado. Para cualquier otra persona, el estado "no existe". */
  async listViews(ownerId: string, id: string): Promise<StatusViewDto[]> {
    const row = await this.statuses.findOwnedActive(id, ownerId, new Date());
    if (!row) throw new NotFoundException(NOT_FOUND);
    const views = await this.statuses.listViews(id);
    return views.map((view) => ({ user: toVisibleUser(view.user), viewedAt: view.viewedAt.toISOString() }));
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

  async getPrivacy(userId: string): Promise<StatusPrivacyDto> {
    const rows = await this.statuses.getPrivacy(userId);
    return { audience: rows.audience, except: rows.except.map(toVisibleUser), only: rows.only.map(toVisibleUser) };
  }

  /** Guarda la privacidad. Las listas solo admiten personas de TU agenda (por tag). */
  async updatePrivacy(userId: string, input: UpdateStatusPrivacyInput): Promise<StatusPrivacyDto> {
    const agenda = new Map((await this.contacts.listWithUsers(userId)).map((row) => [row.user.tag, row.user.id]));
    const resolve = (tags: string[]): string[] => {
      const ids = [...new Set(tags)].map((tag) => agenda.get(tag));
      if (ids.some((id) => id === undefined)) {
        throw new BadRequestException({ code: 'INVALID_MEMBERS', message: 'Solo podés elegir personas de tu agenda' });
      }
      return ids as string[];
    };
    const before = await this.statuses.listAudienceIds(userId);
    await this.statuses.setPrivacy(userId, input.audience, { except: resolve(input.except), only: resolve(input.only) });
    // Avisa a quienes entran Y a quienes salen de la audiencia (para que su lista se actualice).
    await this.notifyAudience(userId, before);
    return this.getPrivacy(userId);
  }

  private toOwnDto(row: StatusRow, counts?: Map<string, number>): StatusDto {
    return this.toDto(row, { viewed: true, viewCount: counts?.get(row.id) ?? 0 });
  }

  private toDto(row: StatusRow, context: DtoContext): StatusDto {
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
      viewed: context.viewed,
      viewCount: context.viewCount,
    };
  }

  /**
   * Aviso en tiempo real: SOLO a quienes pueden ver los estados (y a la propia persona, por si
   * tiene la app abierta en otro dispositivo). Lleva solo el id del dueño, nunca el contenido.
   */
  private async notifyAudience(ownerId: string, extra: string[] = []): Promise<void> {
    const audience = await this.statuses.listAudienceIds(ownerId);
    this.realtime.toUsers([...new Set([ownerId, ...audience, ...extra])], 'status:changed', { ownerId });
  }

  private async deleteBlob(storageKey: string): Promise<void> {
    await this.storage.delete(storageKey).catch((error: Error) => this.logger.error(`No se pudo borrar el archivo de un estado: ${error.message}`));
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

function toVisibleUser(user: UserRow) {
  return user.isPrivate ? toLimitedUser(user) : toPublicUser(user);
}

function isBackground(value: string | null): value is StatusBackground {
  return value !== null && (STATUS_BACKGROUNDS as readonly string[]).includes(value);
}
