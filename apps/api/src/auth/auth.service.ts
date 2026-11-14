import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  APPEAL_RETRY_DAYS,
  getPasswordIssues,
  PASSWORD_ISSUE_MESSAGES,
  type AppealInput,
  type LoginInput,
  type MfaMethod,
  type MfaVerifyInput,
  type RegisterInput,
  type ResetPasswordInput,
  type SelfUser,
} from '@qemzagram/shared';
import { AuditService } from '../common/audit.service';
import type { ClientMeta } from '../common/decorators';
import { CryptoService } from '../common/crypto.service';
import { toSelfUser } from '../common/mappers';
import { isUniqueViolation } from '../database/database.types';
import { AppealsRepository } from '../database/repositories/appeals.repository';
import { EmailTokensRepository } from '../database/repositories/email-tokens.repository';
import { SessionsRepository } from '../database/repositories/sessions.repository';
import { UsersRepository } from '../database/repositories/users.repository';
import type { UserRow } from '../database/schema';
import { MailPort } from '../mail/mail.port';
import { MfaService } from '../mfa/mfa.service';
import {
  LOCK_DURATION_MS,
  MAX_FAILED_LOGINS,
  REFRESH_TTL_SECONDS,
  RESET_TOKEN_TTL_MS,
  VERIFY_TOKEN_TTL_MS,
} from './auth.constants';
import { randomUUID } from 'node:crypto';
import { TokensService } from './tokens.service';

export interface AuthResult {
  user: SelfUser;
  accessToken: string;
  refreshToken: string;
}

/** Resultado del primer paso: sesión lista, o ticket para el segundo factor. */
export type LoginOutcome = { kind: 'session'; session: AuthResult } | { kind: 'mfa'; ticket: string; methods: MfaMethod[] };

const INVALID_MFA = { code: 'INVALID_CODE', message: 'El código no es válido o ya se usó' };
const MFA_EXPIRED = { code: 'MFA_EXPIRED', message: 'Pasó demasiado tiempo. Volvé a ingresar tu contraseña.' };

const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Credenciales incorrectas' };
const INVALID_TOKEN = { code: 'TOKEN_INVALID', message: 'El enlace es inválido o ya venció' };

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly emailTokens: EmailTokensRepository,
    private readonly crypto: CryptoService,
    private readonly tokens: TokensService,
    private readonly mail: MailPort,
    private readonly audit: AuditService,
    private readonly appeals: AppealsRepository,
    private readonly mfa: MfaService,
  ) {}

  /**
   * Registro. El tag se informa si está ocupado (es público de todos modos), pero el correo NO:
   * si ya existe, respondemos igual que si fuera nuevo y avisamos al dueño por mail.
   */
  async register(input: RegisterInput, meta: ClientMeta): Promise<void> {
    if (await this.users.findByTag(input.tag)) {
      throw new ConflictException({ code: 'TAG_TAKEN', message: 'Ese tag ya está en uso' });
    }
    if (await this.users.findByEmail(input.email)) {
      await this.audit.log('register.email_exists', { ip: meta.ip });
      await this.mail.sendAccountAlreadyExists(input.email);
      return;
    }

    const passwordHash = await this.crypto.hashPassword(input.password);
    let user;
    try {
      user = await this.users.create({
        email: input.email,
        tag: input.tag,
        passwordHash,
        displayName: input.displayName ?? input.tag,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Carrera entre dos registros simultáneos: se trata como tag ocupado.
        throw new ConflictException({ code: 'TAG_TAKEN', message: 'Ese tag ya está en uso' });
      }
      throw error;
    }

    await this.audit.log('register', { userId: user.id, ip: meta.ip });
    await this.sendVerification(user.id, user.email, user.displayName);
  }

  async verifyEmail(token: string): Promise<void> {
    const row = await this.emailTokens.findValid(this.crypto.sha256(token), 'verify');
    if (!row) throw new BadRequestException(INVALID_TOKEN);
    await this.emailTokens.consumeVerification(row.id, row.userId);
    await this.audit.log('email.verified', { userId: row.userId });
  }

  /** Respuesta siempre genérica: no revela si el correo existe ni si ya está verificado. */
  async resendVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.emailVerifiedAt || user.status === 'deleted') return;
    await this.sendVerification(user.id, user.email, user.displayName);
  }

  async login(input: LoginInput, meta: ClientMeta): Promise<LoginOutcome> {
    const user = await this.checkCredentials(input.identifier, input.password, meta);
    this.assertCanSignIn(user);

    // Con segundo factor: todavía NO hay sesión, solo un ticket de 5 minutos para el código.
    if (user.mfaEnabled) {
      await this.audit.log('login.mfa_required', { userId: user.id, ip: meta.ip });
      return { kind: 'mfa', ticket: await this.tokens.signMfaTicket(user.id), methods: await this.mfa.methodsFor(user) };
    }
    return { kind: 'session', session: await this.completeLogin(user, meta, 'password') };
  }

  /**
   * Segundo paso del login. Los códigos fallidos cuentan para el MISMO bloqueo que las contraseñas
   * (5 intentos → 15 minutos), así que no se pueden probar los 6 dígitos por fuerza bruta.
   */
  async verifyMfa(ticket: string | undefined, input: MfaVerifyInput, meta: ClientMeta): Promise<AuthResult> {
    if (!ticket) throw new UnauthorizedException(MFA_EXPIRED);
    let userId: string;
    try {
      userId = await this.tokens.verifyMfaTicket(ticket);
    } catch {
      throw new UnauthorizedException(MFA_EXPIRED);
    }
    const user = await this.users.findById(userId);
    if (!user || user.status === 'deleted' || !user.mfaEnabled) throw new UnauthorizedException(MFA_EXPIRED);
    this.assertCanSignIn(user);
    this.assertNotLocked(user, meta);

    if (!(await this.mfa.verifyLoginFactor(user, input))) {
      await this.registerFailure(user, meta);
      await this.audit.log('login.mfa_failed', { userId: user.id, ip: meta.ip, meta: { method: input.method } });
      throw new UnauthorizedException(INVALID_MFA);
    }
    return this.completeLogin(user, meta, input.method);
  }

  /** Estos chequeos van DESPUÉS de validar la contraseña: nadie ajeno aprende el estado de la cuenta. */
  private assertCanSignIn(user: UserRow): void {
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({ code: 'EMAIL_NOT_VERIFIED', message: 'Verificá tu correo para activar la cuenta' });
    }
    if (user.status === 'banned') {
      throw new ForbiddenException({ code: 'ACCOUNT_BANNED', message: 'Esta cuenta fue dada de baja por incumplir las normas' });
    }
  }

  private async completeLogin(user: UserRow, meta: ClientMeta, method: 'password' | MfaMethod): Promise<AuthResult> {
    // Una cuenta pausada por su dueño se reactiva al volver a iniciar sesión.
    const active = await this.users.update(user.id, { status: 'active', failedLogins: 0, lockedUntil: null });
    await this.audit.log('login.success', { userId: user.id, ip: meta.ip, meta: { method } });
    return this.buildSession(active ?? user, meta);
  }

  private assertNotLocked(user: UserRow, meta: ClientMeta): void {
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      void this.audit.log('login.locked', { userId: user.id, ip: meta.ip });
      throw new HttpException({ code: 'ACCOUNT_LOCKED', message: 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.' }, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async registerFailure(user: UserRow, meta: ClientMeta): Promise<void> {
    const attempts = user.failedLogins + 1;
    const shouldLock = attempts >= MAX_FAILED_LOGINS;
    await this.users.update(user.id, {
      failedLogins: shouldLock ? 0 : attempts,
      lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MS) : null,
    });
    await this.audit.log('login.failed', { userId: user.id, ip: meta.ip, meta: { attempts } });
  }

  /**
   * Apelación de una cuenta dada de baja. Pide las MISMAS credenciales que el login
   * (con el mismo bloqueo por intentos fallidos y el mismo tiempo de respuesta), así que
   * solo la dueña o el dueño de la cuenta puede apelar. El mensaje se guarda cifrado.
   */
  async appeal(input: AppealInput, meta: ClientMeta): Promise<void> {
    const user = await this.checkCredentials(input.identifier, input.password, meta);
    if (user.status !== 'banned') {
      throw new ConflictException({ code: 'NOT_BANNED', message: 'Esta cuenta no está dada de baja: podés iniciar sesión normalmente' });
    }
    if (await this.appeals.hasPending(user.id)) {
      throw new ConflictException({ code: 'APPEAL_ALREADY_OPEN', message: 'Ya enviaste una apelación: soporte la está revisando' });
    }
    const lastRejected = await this.appeals.lastRejectedAt(user.id);
    if (lastRejected && Date.now() - lastRejected.getTime() < APPEAL_RETRY_DAYS * 24 * 60 * 60 * 1000) {
      throw new HttpException(
        { code: 'APPEAL_TOO_SOON', message: `Tu última apelación fue rechazada. Podés volver a apelar ${APPEAL_RETRY_DAYS} días después.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const id = randomUUID();
    await this.appeals.create({ id, userId: user.id, messageEncrypted: this.crypto.encryptText(input.message, `appeal:${id}`) });
    await this.users.update(user.id, { failedLogins: 0, lockedUntil: null });
    await this.audit.log('appeal.created', { userId: user.id, ip: meta.ip, meta: { appealId: id } });
  }

  /**
   * Verifica tag/correo + contraseña. Si fallan, responde SIEMPRE lo mismo (sin revelar si la cuenta
   * existe), cuenta el intento y bloquea 15 minutos tras 5 fallos.
   */
  private async checkCredentials(identifier: string, password: string, meta: ClientMeta): Promise<UserRow> {
    // Un correo tiene texto antes y después de la "@"; "@maria" es un tag con arroba inicial.
    const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(identifier);
    const user = looksLikeEmail ? await this.users.findByEmail(identifier) : await this.users.findByTag(identifier.replace(/^@/, ''));

    if (!user || user.status === 'deleted') {
      await this.crypto.verifyDummy(password); // mismo tiempo de respuesta que un usuario real
      await this.audit.log('login.failed', { ip: meta.ip });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.assertNotLocked(user, meta);

    if (!(await this.crypto.verifyPassword(user.passwordHash, password))) {
      await this.registerFailure(user, meta);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    return user;
  }

  async refresh(refreshToken: string | undefined, meta: ClientMeta): Promise<AuthResult> {
    if (!refreshToken) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sesión vencida' });

    const session = await this.sessions.findByHash(this.crypto.sha256(refreshToken));
    if (!session) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sesión vencida' });

    if (session.revokedAt) {
      // Un token ya usado reapareció: probable robo. Se cierran TODAS las sesiones de esa cuenta.
      await this.sessions.revokeAllForUser(session.userId);
      await this.audit.log('session.reuse_detected', { userId: session.userId, ip: meta.ip });
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sesión vencida' });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sesión vencida' });
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== 'active') throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Sesión vencida' });

    const nextRefresh = this.crypto.randomToken(48);
    await this.sessions.rotate(session.id, {
      userId: user.id,
      refreshHash: this.crypto.sha256(nextRefresh),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });
    return { user: toSelfUser(user), accessToken: await this.tokens.signAccess(user.id), refreshToken: nextRefresh };
  }

  async logout(refreshToken: string | undefined, userId?: string): Promise<void> {
    if (refreshToken) {
      const session = await this.sessions.findByHash(this.crypto.sha256(refreshToken));
      if (session && !session.revokedAt) await this.sessions.revoke(session.id);
    }
    if (userId) await this.audit.log('logout', { userId });
  }

  /** Respuesta siempre genérica para no permitir descubrir qué correos están registrados. */
  async forgotPassword(email: string, meta: ClientMeta): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || !user.emailVerifiedAt || user.status === 'banned' || user.status === 'deleted') return;
    await this.issuePasswordReset(user);
    await this.audit.log('password.reset_requested', { userId: user.id, ip: meta.ip });
  }

  /**
   * Manda el enlace para elegir contraseña nueva al correo REGISTRADO de la cuenta.
   * Lo usa también soporte (reseteo asistido): soporte nunca ve ni elige la contraseña.
   */
  async issuePasswordReset(user: UserRow): Promise<void> {
    const token = this.crypto.randomToken();
    await this.emailTokens.issue(user.id, 'reset', this.crypto.sha256(token), new Date(Date.now() + RESET_TOKEN_TTL_MS));
    await this.mail.sendPasswordReset(user.email, user.displayName, token);
  }

  async resetPassword(input: ResetPasswordInput, meta: ClientMeta): Promise<void> {
    const row = await this.emailTokens.findValid(this.crypto.sha256(input.token), 'reset');
    if (!row) throw new BadRequestException(INVALID_TOKEN);
    const user = await this.users.findById(row.userId);
    if (!user) throw new BadRequestException(INVALID_TOKEN);

    const issues = getPasswordIssues(input.password, { tag: user.tag, email: user.email });
    if (issues.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Datos inválidos',
        issues: issues.map((issue) => ({ path: 'password', message: PASSWORD_ISSUE_MESSAGES[issue] })),
      });
    }

    await this.emailTokens.consumeReset(row.id, user.id, await this.crypto.hashPassword(input.password));
    await this.audit.log('password.reset_done', { userId: user.id, ip: meta.ip });
    await this.mail.sendPasswordChanged(user.email, user.displayName);
  }

  private async sendVerification(userId: string, email: string, displayName: string): Promise<void> {
    const token = this.crypto.randomToken();
    await this.emailTokens.issue(userId, 'verify', this.crypto.sha256(token), new Date(Date.now() + VERIFY_TOKEN_TTL_MS));
    await this.mail.sendVerification(email, displayName, token);
  }

  private async buildSession(user: Parameters<typeof toSelfUser>[0], meta: ClientMeta): Promise<AuthResult> {
    const refreshToken = this.crypto.randomToken(48);
    await this.sessions.create({
      userId: user.id,
      refreshHash: this.crypto.sha256(refreshToken),
      userAgent: meta.userAgent,
      ip: meta.ip,
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });
    return { user: toSelfUser(user), accessToken: await this.tokens.signAccess(user.id), refreshToken };
  }
}
