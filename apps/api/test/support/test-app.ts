import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { CallMediaPort, InvalidMediaEventError, type CallMediaEvent, type JoinTokenInput } from '../../src/calls/call-media.port';
import { loadEnv } from '../../src/config/env';
import { DB, type Database } from '../../src/database/database.types';
import { MailPort } from '../../src/mail/mail.port';
import { totpCode } from '../../src/mfa/totp';
import { users } from '../../src/database/schema';
import { eq } from 'drizzle-orm';
import { PushSender, type PushOptions, type PushResult, type PushTarget } from '../../src/notifications/push.port';
import { AntivirusPort, AntivirusUnavailableError, type ScanResult } from '../../src/media/antivirus.port';
import { MediaRejectedError, MediaTranscoder, type TranscodeResult, type TranscodeTarget } from '../../src/media/transcoder.port';

export const ORIGIN = 'http://localhost:3000';
export const STRONG_PASSWORD = 'Qz!Segura2026-ok';

/** Correo falso: guarda lo "enviado" para poder leer los tokens en los tests. */
export class FakeMail extends MailPort {
  verifications: { to: string; token: string }[] = [];
  resets: { to: string; token: string }[] = [];
  accountExists: string[] = [];
  passwordChanged: string[] = [];
  banned: string[] = [];
  appealResults: { to: string; accepted: boolean }[] = [];
  securityAlerts: { to: string; event: string }[] = [];

  async sendVerification(to: string, _name: string, token: string): Promise<void> {
    this.verifications.push({ to, token });
  }
  async sendAccountAlreadyExists(to: string): Promise<void> {
    this.accountExists.push(to);
  }
  async sendPasswordReset(to: string, _name: string, token: string): Promise<void> {
    this.resets.push({ to, token });
  }
  async sendPasswordChanged(to: string): Promise<void> {
    this.passwordChanged.push(to);
  }
  async sendAccountBanned(to: string): Promise<void> {
    this.banned.push(to);
  }
  async sendAppealResult(to: string, _name: string, accepted: boolean): Promise<void> {
    this.appealResults.push({ to, accepted });
  }
  async sendSecurityAlert(to: string, _name: string, event: string): Promise<void> {
    this.securityAlerts.push({ to, event });
  }
  lastVerification(to: string): string {
    const found = [...this.verifications].reverse().find((item) => item.to === to);
    if (!found) throw new Error(`No hay verificación para ${to}`);
    return found.token;
  }
  lastReset(to: string): string {
    const found = [...this.resets].reverse().find((item) => item.to === to);
    if (!found) throw new Error(`No hay reset para ${to}`);
    return found.token;
  }
}

/** Cadena de prueba estándar EICAR: inofensiva, pero todo antivirus la detecta. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Antivirus falso: detecta EICAR y puede simular que está caído. */
export class FakeAntivirus extends AntivirusPort {
  unavailable = false;
  scanned = 0;
  async scan(data: Buffer): Promise<ScanResult> {
    this.scanned++;
    if (this.unavailable) throw new AntivirusUnavailableError('simulado');
    return data.includes(EICAR) ? { clean: false, signature: 'Eicar-Test-Signature' } : { clean: true };
  }
}

/** Conversor falso: no ejecuta ffmpeg. "MUY-LARGO" en el archivo simula un audio/video demasiado largo. */
export class FakeTranscoder extends MediaTranscoder {
  available = true;
  calls: TranscodeTarget[] = [];
  async isAvailable(): Promise<boolean> {
    return this.available;
  }
  async transcode(input: Buffer, target: TranscodeTarget, maxSeconds: number): Promise<TranscodeResult> {
    this.calls.push(target);
    if (input.includes('MUY-LARGO')) throw new MediaRejectedError('MEDIA_TOO_LONG', `La duración máxima es de ${maxSeconds} segundos`);
    return target === 'voice'
      ? { data: Buffer.from('audio-convertido'), mimeType: 'audio/mp4', durationMs: 4200, width: null, height: null }
      : { data: Buffer.from('video-convertido'), mimeType: 'video/mp4', durationMs: 9000, width: 640, height: 360 };
  }
}

/** Servidor de medios falso: no hay LiveKit; registra tokens emitidos y salas cerradas. */
export class FakeCallMedia extends CallMediaPort {
  readonly url = 'wss://medios.prueba';
  available = true;
  tokens: JoinTokenInput[] = [];
  closedRooms: string[] = [];
  removed: { room: string; identity: string }[] = [];
  isAvailable(): boolean {
    return this.available;
  }
  async createJoinToken(input: JoinTokenInput): Promise<string> {
    this.tokens.push(input);
    return `token-falso.${input.room}.${input.identity}.${input.kind}`;
  }
  async closeRoom(room: string): Promise<void> {
    this.closedRooms.push(room);
  }
  async removeParticipant(room: string, identity: string): Promise<void> {
    this.removed.push({ room, identity });
  }
  /** Firma de prueba: "Bearer firma-valida"; el cuerpo es el evento en JSON. */
  async parseEvent(body: string, authorization: string | undefined): Promise<CallMediaEvent | null> {
    if (authorization !== 'Bearer firma-valida') throw new InvalidMediaEventError('Firma inválida');
    return JSON.parse(body) as CallMediaEvent;
  }
}

/** Envío de push falso: registra lo enviado; las direcciones en `gone` simulan suscripciones vencidas. */
export class FakePushSender extends PushSender {
  readonly publicKey = 'B'.repeat(87);
  sent: { endpoint: string; payload: Record<string, unknown>; options: PushOptions }[] = [];
  gone = new Set<string>();
  isAvailable(): boolean {
    return true;
  }
  async send(target: PushTarget, payload: string, options: PushOptions): Promise<PushResult> {
    if (this.gone.has(target.endpoint)) return 'gone';
    this.sent.push({ endpoint: target.endpoint, payload: JSON.parse(payload) as Record<string, unknown>, options });
    return 'sent';
  }
}

/** Espera a que se cumpla una condición (para tareas que corren "en segundo plano"). */
export async function waitUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('Tiempo de espera agotado');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export interface TestContext {
  app: NestExpressApplication;
  mail: FakeMail;
  antivirus: FakeAntivirus;
  transcoder: FakeTranscoder;
  callMedia: FakeCallMedia;
  push: FakePushSender;
  db: Database;
  close: () => Promise<void>;
}

/** `env`: variables extra para esta app (por ejemplo, activar la prueba anti-bots en su propia suite). */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestContext> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'pglite://memory',
    WEB_ORIGIN: ORIGIN,
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_TICKET_SECRET: randomBytes(32).toString('hex'),
    PASSWORD_PEPPER: randomBytes(16).toString('hex'),
    MESSAGE_ENC_KEY: randomBytes(32).toString('base64'),
    UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'qz-uploads-')),
    MEDIA_DIR: mkdtempSync(join(tmpdir(), 'qz-media-')),
    RUN_MIGRATIONS: 'true',
    // La prueba de trabajo se prueba en pow.spec.ts; en el resto se apaga para no resolverla en cada login.
    POW_ENABLED: 'false',
    POW_DIFFICULTY: '16',
    ...env,
  });
  const mail = new FakeMail();
  const antivirus = new FakeAntivirus();
  const transcoder = new FakeTranscoder();
  const callMedia = new FakeCallMedia();
  const push = new FakePushSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailPort)
    .useValue(mail)
    .overrideProvider(AntivirusPort)
    .useValue(antivirus)
    .overrideProvider(MediaTranscoder)
    .useValue(transcoder)
    .overrideProvider(CallMediaPort)
    .useValue(callMedia)
    .overrideProvider(PushSender)
    .useValue(push)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, loadEnv());
  await app.init();
  return { app, mail, antivirus, transcoder, callMedia, push, db: app.get(DB), close: () => app.close() };
}

export interface TestUser {
  tag: string;
  email: string;
  password: string;
  id: string;
  agent: ReturnType<typeof request.agent>;
}

/** Registra, verifica el correo e inicia sesión. Devuelve un cliente HTTP con la sesión abierta. */
export async function signUp(ctx: TestContext, tag: string, password = STRONG_PASSWORD): Promise<TestUser> {
  const email = `${tag}@example.com`;
  const server = ctx.app.getHttpServer();
  await request(server).post('/auth/register').set('Origin', ORIGIN).send({ email, tag, password }).expect(202);
  await request(server).post('/auth/verify-email').set('Origin', ORIGIN).send({ token: ctx.mail.lastVerification(email) }).expect(200);
  const agent = request.agent(server).set('Origin', ORIGIN);
  const login = await agent.post('/auth/login').send({ identifier: tag, password }).expect(200);
  return { tag, email, password, id: (login.body as { user: { id: string } }).user.id, agent };
}

/** Normaliza la cabecera Set-Cookie (string o lista) a una lista. */
export function setCookies(response: { headers: Record<string, unknown> }): string[] {
  const value = response.headers['set-cookie'];
  if (Array.isArray(value)) return value as string[];
  return typeof value === 'string' ? [value] : [];
}

/**
 * Activa el 2FA (app autenticadora) de una cuenta y devuelve el secreto y los códigos de respaldo.
 * Como el mismo código no sirve dos veces, `freshCode()` "olvida" el último paso usado (solo en tests)
 * y devuelve el código actual.
 */
export async function enableMfa(ctx: TestContext, user: TestUser): Promise<{ secret: string; backupCodes: string[]; freshCode: () => Promise<string> }> {
  const setup = await user.agent.post('/auth/mfa/totp/setup').send({ password: user.password }).expect(200);
  const secret = (setup.body as { secret: string }).secret;
  const enabled = await user.agent.post('/auth/mfa/totp/enable').send({ code: totpCode(secret) }).expect(200);
  return {
    secret,
    backupCodes: (enabled.body as { codes: string[] }).codes,
    freshCode: async () => {
      await ctx.db.update(users).set({ totpLastStep: null }).where(eq(users.id, user.id));
      return totpCode(secret);
    },
  };
}
