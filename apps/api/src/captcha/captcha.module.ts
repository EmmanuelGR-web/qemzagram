import { Global, Module } from '@nestjs/common';
import { PowController } from './pow.controller';
import { PowGuard } from './pow.guard';
import { PowService } from './pow.service';

@Global()
@Module({ controllers: [PowController], providers: [PowService, PowGuard], exports: [PowService, PowGuard] })
export class CaptchaModule {}
