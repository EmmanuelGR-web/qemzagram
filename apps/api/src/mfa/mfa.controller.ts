import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { mfaConfirmSchema, totpEnableSchema, totpSetupSchema, type BackupCodesDto, type MfaStatusDto, type TotpSetupDto } from '@qemzagram/shared';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MfaService } from './mfa.service';

/** Configuración del segundo factor (con sesión). El segundo paso del login está en AuthController. */
@Controller('auth/mfa')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get()
  status(@CurrentUser() user: AuthUser): Promise<MfaStatusDto> {
    return this.mfa.status(user.id);
  }

  @Post('totp/setup')
  @HttpCode(200)
  setup(@CurrentUser() user: AuthUser, @Body(new ZodPipe(totpSetupSchema)) body: { password: string }): Promise<TotpSetupDto> {
    return this.mfa.startTotpSetup(user.id, body.password);
  }

  @Post('totp/enable')
  @HttpCode(200)
  enable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(totpEnableSchema)) body: { code: string }): Promise<BackupCodesDto> {
    return this.mfa.enableTotp(user.id, body.code);
  }

  @Post('totp/disable')
  @HttpCode(204)
  disable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaConfirmSchema)) body: { password: string; code: string }): Promise<void> {
    return this.mfa.disableTotp(user.id, body.password, body.code);
  }

  @Post('backup-codes')
  @HttpCode(200)
  regenerate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaConfirmSchema)) body: { password: string; code: string }): Promise<BackupCodesDto> {
    return this.mfa.regenerateBackupCodes(user.id, body.password, body.code);
  }
}
