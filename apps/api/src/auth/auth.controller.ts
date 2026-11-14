import { Body, Controller, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  appealSchema,
  forgotPasswordSchema,
  mfaVerifySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
  type SelfUser,
  type AppealInput,
  type LoginResultDto,
  type MfaVerifyInput,
} from '@qemzagram/shared';
import type { CookieOptions, Request, Response } from 'express';
import { clientMeta, CurrentUser, Public, type AuthUser } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, type AppEnv } from '../config/env';
import { MFA_LOGIN_MINUTES } from '@qemzagram/shared';
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, MFA_COOKIE, REFRESH_COOKIE, REFRESH_TTL_SECONDS } from './auth.constants';
import { AuthService, type AuthResult } from './auth.service';
import { TokensService } from './tokens.service';

const GENERIC_OK = { message: 'Si los datos son correctos, te enviamos un correo con los pasos a seguir.' };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    @Inject(ENV) private readonly env: AppEnv,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(@Body(new ZodPipe(registerSchema)) body: RegisterInput, @Req() request: Request) {
    await this.auth.register(body, clientMeta(request));
    return { message: 'Te enviamos un correo para verificar tu cuenta. Revisá tu bandeja (y el spam).' };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(@Body(new ZodPipe(tokenSchema)) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
    return { message: 'Correo verificado. Ya podés iniciar sesión.' };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }) {
    await this.auth.resendVerification(body.email);
    return GENERIC_OK;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResultDto> {
    const outcome = await this.auth.login(body, clientMeta(request));
    if (outcome.kind === 'mfa') {
      // El ticket viaja en una cookie HttpOnly (nunca en el cuerpo ni en el almacenamiento del navegador).
      response.cookie(MFA_COOKIE, outcome.ticket, { ...this.cookieBase(), path: '/auth', maxAge: MFA_LOGIN_MINUTES * 60 * 1000 });
      return { mfaRequired: true, methods: outcome.methods };
    }
    this.setCookies(response, outcome.session);
    return { mfaRequired: false, user: outcome.session.user };
  }

  /** Segundo paso del login: código de la app autenticadora o de respaldo. */
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyMfa(
    @Body(new ZodPipe(mfaVerifySchema)) body: MfaVerifyInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResultDto> {
    const result = await this.auth.verifyMfa(this.readCookie(request, MFA_COOKIE), body, clientMeta(request));
    response.clearCookie(MFA_COOKIE, { ...this.cookieBase(), path: '/auth' });
    this.setCookies(response, result);
    return { mfaRequired: false, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ user: SelfUser }> {
    try {
      const result = await this.auth.refresh(this.readCookie(request, REFRESH_COOKIE), clientMeta(request));
      this.setCookies(response, result);
      return { user: result.user };
    } catch (error) {
      this.clearCookies(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(this.readCookie(request, REFRESH_COOKIE));
    this.clearCookies(response);
  }

  /** Apelación de una cuenta dada de baja (pública: esa cuenta no puede iniciar sesión). */
  @Public()
  @Post('appeal')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async appeal(@Body(new ZodPipe(appealSchema)) body: AppealInput, @Req() request: Request) {
    await this.auth.appeal(body, clientMeta(request));
    return { message: 'Recibimos tu apelación. Soporte la va a revisar y te vamos a avisar por correo.' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(@Body(new ZodPipe(forgotPasswordSchema)) body: { email: string }, @Req() request: Request) {
    await this.auth.forgotPassword(body.email, clientMeta(request));
    return GENERIC_OK;
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body(new ZodPipe(resetPasswordSchema)) body: ResetPasswordInput, @Req() request: Request) {
    await this.auth.resetPassword(body, clientMeta(request));
    return { message: 'Contraseña actualizada. Iniciá sesión con la nueva.' };
  }

  /** Ticket de 60 s para abrir la conexión en tiempo real (WebSocket). */
  @Post('ws-ticket')
  @HttpCode(200)
  async wsTicket(@CurrentUser() user: AuthUser): Promise<{ ticket: string }> {
    return { ticket: await this.tokens.signWsTicket(user.id) };
  }

  private readCookie(request: Request, name: string): string | undefined {
    const value = (request.cookies as Record<string, unknown> | undefined)?.[name];
    return typeof value === 'string' ? value : undefined;
  }

  private cookieBase(): CookieOptions {
    return { httpOnly: true, secure: this.env.NODE_ENV === 'production', sameSite: 'strict' };
  }

  private setCookies(response: Response, result: AuthResult): void {
    response.cookie(ACCESS_COOKIE, result.accessToken, { ...this.cookieBase(), path: '/', maxAge: ACCESS_TTL_SECONDS * 1000 });
    response.cookie(REFRESH_COOKIE, result.refreshToken, {
      ...this.cookieBase(),
      path: '/auth',
      maxAge: REFRESH_TTL_SECONDS * 1000,
    });
  }

  private clearCookies(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, { ...this.cookieBase(), path: '/' });
    response.clearCookie(REFRESH_COOKIE, { ...this.cookieBase(), path: '/auth' });
  }
}
