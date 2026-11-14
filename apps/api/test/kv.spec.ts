import { loadEnv } from '../src/config/env';
import { KvThrottlerStorage } from '../src/kv/kv-throttler.storage';
import { MemoryKeyValueStore } from '../src/kv/memory-kv.store';

describe('Almacén compartido y límites de peticiones', () => {
  let store: MemoryKeyValueStore;

  beforeEach(() => {
    store = new MemoryKeyValueStore();
  });
  afterEach(() => {
    store.onModuleDestroy();
  });

  it('setIfAbsent es de un solo uso hasta que vence', async () => {
    expect(await store.setIfAbsent('a', 50)).toBe(true);
    expect(await store.setIfAbsent('a', 50)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(await store.setIfAbsent('a', 50)).toBe(true);
  });

  it('increment cuenta dentro de la ventana y reinicia al vencer', async () => {
    expect((await store.increment('c', 60)).count).toBe(1);
    const second = await store.increment('c', 60);
    expect(second.count).toBe(2);
    expect(second.msLeft).toBeLessThanOrEqual(60);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await store.increment('c', 60)).count).toBe(1);
  });

  it('el límite de peticiones bloquea al pasar el máximo y avisa cuándo reintentar (en segundos)', async () => {
    const throttler = new KvThrottlerStorage(store);
    for (let hit = 1; hit <= 3; hit++) expect((await throttler.increment('ip-1', 60_000, 3, 60_000, 'default')).isBlocked).toBe(false);
    const blocked = await throttler.increment('ip-1', 60_000, 3, 60_000, 'default');
    expect(blocked).toMatchObject({ totalHits: 4, isBlocked: true });
    expect(blocked.timeToExpire).toBeGreaterThan(50);
    expect(blocked.timeToBlockExpire).toBe(blocked.timeToExpire);
    // Otra IP u otro limitador no se ven afectados.
    expect((await throttler.increment('ip-2', 60_000, 3, 60_000, 'default')).isBlocked).toBe(false);
    expect((await throttler.increment('ip-1', 60_000, 3, 60_000, 'login')).isBlocked).toBe(false);
  });

  it('la configuración valida REDIS_URL y exige la prueba anti-bots en producción', () => {
    const base = {
      DATABASE_URL: 'pglite://memory',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      JWT_TICKET_SECRET: 'y'.repeat(32),
      PASSWORD_PEPPER: 'z'.repeat(16),
      MESSAGE_ENC_KEY: Buffer.alloc(32, 1).toString('base64'),
    };
    expect(() => loadEnv({ ...base, REDIS_URL: 'http://redis:6379' })).toThrow();
    expect(loadEnv({ ...base, REDIS_URL: 'rediss://usuario:clave@redis.example:6380' }).REDIS_URL).toContain('rediss://');
    const production = { ...base, NODE_ENV: 'production', CLAMAV_HOST: 'clamav', LIVEKIT_URL: 'wss://livekit.example' };
    expect(() => loadEnv({ ...production, POW_ENABLED: 'false' })).toThrow(/anti-bots/);
    expect(() => loadEnv({ ...production, POW_DIFFICULTY: '8' })).toThrow(/anti-bots/);
  });
});
