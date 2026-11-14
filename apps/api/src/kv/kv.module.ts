import { Global, Module } from '@nestjs/common';
import { KeyValueStore } from './kv.port';
import { MemoryKeyValueStore } from './memory-kv.store';

@Global()
@Module({
  providers: [{ provide: KeyValueStore, useClass: MemoryKeyValueStore }],
  exports: [KeyValueStore],
})
export class KvModule {}
