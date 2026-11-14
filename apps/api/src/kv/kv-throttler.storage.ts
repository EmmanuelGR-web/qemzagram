import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { KeyValueStore } from './kv.port';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/**
 * Límites de peticiones guardados en el almacén compartido (memoria o Redis).
 * Con Redis, el límite vale para TODAS las instancias juntas (sin Redis, cada instancia cuenta aparte).
 */
@Injectable()
export class KvThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly store: KeyValueStore) {}

  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const { count, msLeft } = await this.store.increment(`throttle:${throttlerName}:${key}`, ttl);
    const seconds = Math.max(1, Math.ceil(msLeft / 1000));
    return { totalHits: count, timeToExpire: seconds, isBlocked: count > limit, timeToBlockExpire: count > limit ? seconds : 0 };
  }
}
