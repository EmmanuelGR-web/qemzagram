import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  mfaConfirmSchema,
  passkeyDeleteSchema,
  passkeyOptionsSchema,
  passkeyRegisterSchema,
  totpEnableSchema,
  totpSetupSchema,
  type BackupCodesDto,
  type MfaStatusDto,
  type PasskeyDto,
  type PasskeyRegisterInput,
  type PasskeyRegisteredDto,
  type TotpSetupDto,
} from '@qemzagram/shared';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { CurrentUser, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { MfaService } from './mfa.service';
import { PasskeysService } from './passkeys.service';

/** Configuración del segundo factor (con sesión). El segundo paso del login está en AuthController. */
@Controller('auth/mfa')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly passkeys: PasskeysService,
  ) {}

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

  @Get('passkeys')
  listPasskeys(@CurrentUser() user: AuthUser): Promise<PasskeyDto[]> {
    return this.passkeys.list(user.id);
  }

  @Post('passkeys/options')
  @HttpCode(200)
  passkeyOptions(@CurrentUser() user: AuthUser, @Body(new ZodPipe(passkeyOptionsSchema)) body: { password: string }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return this.passkeys.registrationOptions(user.id, body.password);
  }

  @Post('passkeys')
  @HttpCode(201)
  registerPasskey(@CurrentUser() user: AuthUser, @Body(new ZodPipe(passkeyRegisterSchema)) body: PasskeyRegisterInput): Promise<PasskeyRegisteredDto> {
    return this.passkeys.register(user.id, body.name, body.response);
  }

  /** Borrar con POST (y no DELETE con cuerpo): algunos intermediarios descartan el cuerpo de un DELETE. */
  @Post('passkeys/:id/delete')
  @HttpCode(204)
  removePasskey(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(passkeyDeleteSchema)) body: { password: string },
  ): Promise<void> {
    return this.passkeys.remove(user.id, id, body.password);
  }

  @Post('backup-codes')
  @HttpCode(200)
  regenerate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaConfirmSchema)) body: { password: string; code: string }): Promise<BackupCodesDto> {
    return this.mfa.regenerateBackupCodes(user.id, body.password, body.code);
  }
}
