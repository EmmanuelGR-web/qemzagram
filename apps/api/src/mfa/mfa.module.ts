import { Module } from '@nestjs/common';
import { MfaController } from './mfa.controller';
import { MfaService } from './mfa.service';
import { PasskeysService } from './passkeys.service';

@Module({ controllers: [MfaController], providers: [MfaService, PasskeysService], exports: [MfaService, PasskeysService] })
export class MfaModule {}
