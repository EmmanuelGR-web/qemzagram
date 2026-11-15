import { Global, Module } from '@nestjs/common';
import { ENV, type AppEnv } from '../config/env';
import { BlobStorage } from './blob-storage.port';
import { LocalBlobStorage } from './local-blob-storage';
import { S3BlobStorage, s3ConfigFromEnv } from './s3-blob-storage';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    StorageService,
    {
      // El adaptador se elige con STORAGE_DRIVER; el resto del código solo conoce el puerto BlobStorage.
      provide: BlobStorage,
      inject: [ENV],
      useFactory: (env: AppEnv): BlobStorage => (env.STORAGE_DRIVER === 's3' ? new S3BlobStorage(s3ConfigFromEnv(env)) : new LocalBlobStorage(env)),
    },
  ],
  exports: [StorageService, BlobStorage],
})
export class StorageModule {}
