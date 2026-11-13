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
import { CallMediaPort, type JoinTokenInput } from '../../src/calls/call-media.port';
import { loadEnv } from '../../src/config/env';
import { DB, type Database } from '../../src/database/database.types';
import { MailPort } from '../../src/mail/mail.port';
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
}

export interface TestContext {
  app: NestExpressApplication;
  mail: FakeMail;
  antivirus: FakeAntivirus;
  transcoder: FakeTranscoder;
  callMedia: FakeCallMedia;
  db: Database;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
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
  });
  const mail = new FakeMail();
  const antivirus = new FakeAntivirus();
  const transcoder = new FakeTranscoder();
  const callMedia = new FakeCallMedia();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailPort)
    .useValue(mail)
    .overrideProvider(AntivirusPort)
    .useValue(antivirus)
    .overrideProvider(MediaTranscoder)
    .useValue(transcoder)
    .overrideProvider(CallMediaPort)
    .useValue(callMedia)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, loadEnv());
  await app.init();
  return { app, mail, antivirus, transcoder, callMedia, db: app.get(DB), close: () => app.close() };
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
