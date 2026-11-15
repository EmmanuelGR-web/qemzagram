import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { RetentionService } from './retention.service';

@Global()
@Module({
  providers: [CryptoService, AuditService, RetentionService],
  exports: [CryptoService, AuditService, RetentionService],
})
export class CommonModule {}
