import { ConflictException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  NEARBY_CELL_DEGREES,
  NEARBY_DISTANCES,
  NEARBY_MAX_CHANGES_PER_DAY,
  NEARBY_MAX_KM,
  NEARBY_MAX_ROW,
  NEARBY_MIN_CHANGE_SECONDS,
  NEARBY_RESULTS_MAX,
  NEARBY_VISIBLE_MINUTES,
  nearbyCellDistanceKm,
  nearbyDistanceBucket,
  type NearbyCell,
  type NearbyPersonDto,
  type NearbyStatusDto,
} from '@qemzagram/shared';
import { randomInt } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { NearbyRepository } from '../database/repositories/nearby.repository';
import type { NearbyPresenceRow } from '../database/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Filas de la grilla que abarca el radio de búsqueda (1° de latitud ≈ 111,2 km), con una de margen. */
const ROW_SPAN = Math.ceil(NEARBY_MAX_KM / (NEARBY_CELL_DEGREES * 111.2)) + 1;

/**
 * Personas cercanas. Protecciones (ver SEGURIDAD.md §2.4):
 * - Solo celdas de ~1 km (la ubicación exacta nunca llega al servidor) y distancias por rangos.
 * - Opt-in que vence a la hora; al apagarla se borra la celda.
 * - Para ver a otros tenés que estar visible vos (nadie mira sin ser visto).
 * - Anti-rastreo: cambios de zona con 2 min de diferencia y como mucho 20 por día.
 * - Dentro de cada rango, el orden es al azar (no filtra distancias más finas).
 */
@Injectable()
export class NearbyService {
  constructor(
    private readonly nearby: NearbyRepository,
    private readonly audit: AuditService,
  ) {}

  async status(userId: string, now = new Date()): Promise<NearbyStatusDto> {
    return this.toStatus(await this.nearby.get(userId), now);
  }

  /** Activa o renueva la visibilidad por una hora en la celda indicada. */
  async show(userId: string, cell: NearbyCell, now = new Date()): Promise<NearbyStatusDto> {
    const current = await this.nearby.get(userId);
    const wasVisible = isVisible(current, now);
    const sameCell = wasVisible && current?.cellRow === cell.row && current.cellCol === cell.col;

    let { cellChangedAt, changesWindowStart, changesCount } = current ?? { cellChangedAt: null, changesWindowStart: null, changesCount: 0 };
    if (!sameCell) {
      if (cellChangedAt && now.getTime() - cellChangedAt.getTime() < NEARBY_MIN_CHANGE_SECONDS * 1000) {
        throw new HttpException(
          { code: 'NEARBY_TOO_FAST', message: 'Cambiaste de zona hace muy poco. Probá de nuevo en unos minutos.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (!changesWindowStart || now.getTime() - changesWindowStart.getTime() >= DAY_MS) {
        changesWindowStart = now;
        changesCount = 0;
      }
      if (changesCount >= NEARBY_MAX_CHANGES_PER_DAY) {
        throw new HttpException(
          { code: 'NEARBY_DAILY_LIMIT', message: 'Llegaste al máximo de cambios de zona por hoy.' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      cellChangedAt = now;
      changesCount += 1;
    }

    const saved = {
      cellRow: cell.row,
      cellCol: cell.col,
      visibleUntil: new Date(now.getTime() + NEARBY_VISIBLE_MINUTES * 60 * 1000),
      cellChangedAt,
      changesWindowStart,
      changesCount,
    };
    await this.nearby.save(userId, saved);
    // La auditoría NUNCA guarda la ubicación.
    if (!wasVisible) await this.audit.log('nearby.enabled', { userId });
    return this.toStatus({ userId, updatedAt: now, ...saved }, now);
  }

  /** Modo invisible: deja de aparecer y se borra la celda guardada. */
  async hide(userId: string): Promise<void> {
    const current = await this.nearby.get(userId);
    await this.nearby.hide(userId);
    if (current?.cellRow !== null && current?.cellRow !== undefined) await this.audit.log('nearby.disabled', { userId });
  }

  async list(userId: string, now = new Date()): Promise<NearbyPersonDto[]> {
    const me = await this.nearby.get(userId);
    if (!me || !isVisible(me, now) || me.cellRow === null || me.cellCol === null) {
      throw new ConflictException({ code: 'NEARBY_NOT_VISIBLE', message: 'Activá tu visibilidad para ver a personas cercanas' });
    }
    const origin = { row: me.cellRow, col: me.cellCol };
    const candidates = await this.nearby.listCandidates(userId, Math.max(0, origin.row - ROW_SPAN), Math.min(NEARBY_MAX_ROW - 1, origin.row + ROW_SPAN), now);

    const byBucket = new Map(NEARBY_DISTANCES.map((bucket) => [bucket, [] as NearbyPersonDto[]]));
    for (const candidate of candidates) {
      const distance = nearbyDistanceBucket(nearbyCellDistanceKm(origin, candidate));
      if (!distance) continue;
      byBucket.get(distance)?.push({
        user: { id: candidate.user.id, displayName: candidate.user.displayName, avatarUrl: candidate.user.avatarUrl },
        distance,
      });
    }
    return NEARBY_DISTANCES.flatMap((bucket) => shuffle(byBucket.get(bucket) ?? [])).slice(0, NEARBY_RESULTS_MAX);
  }

  hideExpired(now = new Date()): Promise<number> {
    return this.nearby.hideExpired(now);
  }

  removeAllFor(userId: string): Promise<void> {
    return this.nearby.remove(userId);
  }

  private toStatus(row: NearbyPresenceRow | undefined, now: Date): NearbyStatusDto {
    const visible = isVisible(row, now);
    const windowOpen = row?.changesWindowStart && now.getTime() - row.changesWindowStart.getTime() < DAY_MS;
    return {
      visible,
      visibleUntil: visible && row?.visibleUntil ? row.visibleUntil.toISOString() : null,
      changesLeft: Math.max(0, NEARBY_MAX_CHANGES_PER_DAY - (windowOpen ? (row?.changesCount ?? 0) : 0)),
    };
  }
}

function isVisible(row: NearbyPresenceRow | undefined, now: Date): boolean {
  return Boolean(row && row.cellRow !== null && row.cellCol !== null && row.visibleUntil && row.visibleUntil > now);
}

/** Fisher–Yates con números aleatorios criptográficos. */
function shuffle<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [items[index], items[other]] = [items[other] as T, items[index] as T];
  }
  return items;
}
