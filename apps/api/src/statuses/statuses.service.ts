import { BadRequestException, Injectable } from '@nestjs/common';
import {
  STATUS_ACTIVE_MAX,
  STATUS_BACKGROUNDS,
  STATUS_TTL_HOURS,
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

const TTL_MS = STATUS_TTL_HOURS * 60 * 60 * 1000;
const UNAVAILABLE_BODY = '[Estado no disponible]';

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

  toDto(row: StatusRow): StatusDto {
    return {
      id: row.id,
      ownerId: row.ownerId,
      kind: row.kind,
      body: this.decryptBody(row),
      background: isBackground(row.background) ? row.background : null,
      media: null,
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
