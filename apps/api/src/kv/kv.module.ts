import { Global, Logger, Module } from '@nestjs/common';
import { ENV, type AppEnv } from '../config/env';
import { KvThrottlerStorage } from './kv-throttler.storage';
import { KeyValueStore } from './kv.port';
import { MemoryKeyValueStore } from './memory-kv.store';
import { RedisKeyValueStore } from './redis-kv.store';

/** Sin REDIS_URL: memoria (una instancia). Con REDIS_URL: Redis compartido entre instancias. */
@Global()
@Module({
  providers: [
    {
      provide: KeyValueStore,
      inject: [ENV],
      useFactory: (env: AppEnv): KeyValueStore => {
        if (env.REDIS_URL) return RedisKeyValueStore.connect(env.REDIS_URL);
        if (env.NODE_ENV === 'production') {
          new Logger('KvModule').warn('Sin REDIS_URL: los límites de peticiones son por instancia. Con más de una instancia, configurá Redis.');
        }
        return new MemoryKeyValueStore();
      },
    },
    KvThrottlerStorage,
  ],
  exports: [KeyValueStore, KvThrottlerStorage],
})
export class KvModule {}
