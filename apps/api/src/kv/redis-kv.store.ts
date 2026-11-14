import { Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { KeyValueStore } from './kv.port';

/**
 * INCR + vencimiento en UN paso (script Lua, atómico en Redis): si dos instancias suman a la vez,
 * ninguna pisa a la otra y el vencimiento se fija solo la primera vez.
 */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

/** Almacén compartido en Redis: para varias instancias de la API detrás de un balanceador. */
export class RedisKeyValueStore extends KeyValueStore implements OnModuleDestroy {
  private readonly logger = new Logger(RedisKeyValueStore.name);

  constructor(private readonly redis: Redis) {
    super();
    this.redis.on('error', (error: Error) => this.logger.error(`Redis: ${error.message}`));
  }

  static connect(url: string): RedisKeyValueStore {
    // Prefijo propio: si el Redis se comparte con otra app, las claves no se mezclan.
    return new RedisKeyValueStore(new Redis(url, { keyPrefix: 'qz:', maxRetriesPerRequest: 2, enableOfflineQueue: false }));
  }

  async setIfAbsent(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'PX', Math.max(1, Math.ceil(ttlMs)), 'NX');
    return result === 'OK';
  }

  async increment(key: string, ttlMs: number): Promise<{ count: number; msLeft: number }> {
    const result = (await this.redis.eval(INCREMENT_SCRIPT, 1, key, String(Math.max(1, Math.ceil(ttlMs))))) as [number, number];
    const [count, ttl] = result;
    return { count, msLeft: ttl > 0 ? ttl : ttlMs };
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
