import { Global, Module } from '@nestjs/common';
import { BlobStorage } from './blob-storage.port';
import { LocalBlobStorage } from './local-blob-storage';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [StorageService, { provide: BlobStorage, useClass: LocalBlobStorage }],
  exports: [StorageService, BlobStorage],
})
export class StorageModule {}
