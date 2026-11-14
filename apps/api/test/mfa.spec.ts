import type { BackupCodesDto, LoginResultDto, MfaStatusDto, SelfUser, TotpSetupDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { mfaBackupCodes, users } from '../src/database/schema';
import { base32Decode, base32Encode, hotp, totpCode, verifyTotp } from '../src/mfa/totp';
import { createTestApp, enableMfa, ORIGIN, setCookies, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Verificación en dos pasos (TOTP + códigos de respaldo)', () => {
  let ctx: TestContext;

  /** Login "desde cero" en un navegador nuevo (agente con sus propias cookies). */
  const freshLogin = async (user: TestUser) => {
    const agent = request.agent(ctx.app.getHttpServer()).set('Origin', ORIGIN);
    const response = await agent.post('/auth/login').send({ identifier: user.tag, password: user.password }).expect(200);
    return { agent, response, body: response.body as LoginResultDto };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('el algoritmo coincide con los vectores oficiales de los RFC 4226 y 6238', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(['755224', '287082', '359152', '969429'].map((_, counter) => hotp(secret, counter))).toEqual(['755224', '287082', '359152', '969429']);
    expect(hotp(secret, 1, 8)).toBe('94287082'); // RFC 6238, T = 59 s
    expect(totpCode(base32Encode(secret), 59_000)).toBe('287082');
    expect(base32Decode(base32Encode(secret)).toString()).toBe('12345678901234567890');
    // ±1 paso de tolerancia, nunca más; y un paso ya usado no vuelve a servir.
    const b32 = base32Encode(secret);
    expect(verifyTotp(b32, totpCode(b32, 59_000), 89_000, null)).toBe(1);
    expect(verifyTotp(b32, totpCode(b32, 59_000), 150_000, null)).toBeNull();
    expect(verifyTotp(b32, totpCode(b32, 59_000), 59_000, 1)).toBeNull();
  });

  it('activar exige sesión, contraseña y un primer código correcto; el secreto se guarda cifrado', async () => {
    const ana = await signUp(ctx, 'ana.mfa', 'An#DosPasos2026-ok');
    await request(ctx.app.getHttpServer()).post('/auth/mfa/totp/setup').set('Origin', ORIGIN).send({ password: ana.password }).expect(401);
    expect((await ana.agent.post('/auth/mfa/totp/setup').send({ password: 'Otra#Clave2026-mal' }).expect(403)).body.code).toBe('INVALID_PASSWORD');
    expect((await ana.agent.post('/auth/mfa/totp/enable').send({ code: '123456' }).expect(409)).body.code).toBe('TOTP_SETUP_REQUIRED');

    const setup = (await ana.agent.post('/auth/mfa/totp/setup').send({ password: ana.password }).expect(200)).body as TotpSetupDto;
    expect(setup.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Qemzagram%3A%40ana\.mfa\?secret=/);
    await ana.agent.post('/auth/mfa/totp/enable').send({ code: 'abcdef' }).expect(400);
    const wrong = totpCode(setup.secret) === '000000' ? '111111' : '000000';
    expect((await ana.agent.post('/auth/mfa/totp/enable').send({ code: wrong }).expect(400)).body.code).toBe('INVALID_CODE');

    const codes = (await ana.agent.post('/auth/mfa/totp/enable').send({ code: totpCode(setup.secret) }).expect(200)).body as BackupCodesDto;
    expect(codes.codes).toHaveLength(10);
    expect(codes.codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await ana.agent.get('/auth/mfa').expect(200)).body as MfaStatusDto).toEqual({ enabled: true, totp: true, backupCodesLeft: 10, passkeys: [] });
    expect(((await ana.agent.get('/users/me').expect(200)).body as SelfUser).mfaEnabled).toBe(true);
    expect(ctx.mail.securityAlerts).toContainEqual({ to: ana.email, event: 'mfa_enabled' });

    const [row] = await ctx.db.select().from(users).where(eq(users.id, ana.id));
    expect(row?.totpSecretEncrypted).toBeTruthy();
    expect(row?.totpSecretEncrypted).not.toContain(setup.secret);
    const stored = await ctx.db.select().from(mfaBackupCodes).where(eq(mfaBackupCodes.userId, ana.id));
    expect(stored.map((item) => item.codeHash)).not.toContain(codes.codes[0]?.replace('-', ''));
  });

  it('login en dos pasos: sin el código NO hay sesión, y el mismo código no sirve dos veces', async () => {
    const beto = await signUp(ctx, 'beto.mfa', 'Be#DosPasos2026-ok');
    const mfa = await enableMfa(ctx, beto);

    const first = await freshLogin(beto);
    expect(first.body).toEqual({ mfaRequired: true, methods: ['totp', 'backup'] });
    const cookies = setCookies(first.response);
    expect(cookies.some((cookie) => cookie.startsWith('qz_at='))).toBe(false); // todavía sin sesión
    const ticket = cookies.find((cookie) => cookie.startsWith('qz_mfa='));
    expect(ticket).toMatch(/HttpOnly/i);
    expect(ticket).toMatch(/SameSite=Strict/i);
    await first.agent.get('/users/me').expect(401);

    const code = await mfa.freshCode();
    const done = await first.agent.post('/auth/mfa/verify').send({ method: 'totp', code }).expect(200);
    expect((done.body as LoginResultDto).mfaRequired).toBe(false);
    await first.agent.get('/users/me').expect(200);

    // Anti-repetición: el mismo código, en otro login, ya no sirve.
    const second = await freshLogin(beto);
    expect((await second.agent.post('/auth/mfa/verify').send({ method: 'totp', code }).expect(401)).body.code).toBe('INVALID_CODE');

    // Sin ticket (no pasó por la contraseña) no hay segundo paso.
    expect((await request(ctx.app.getHttpServer()).post('/auth/mfa/verify').set('Origin', ORIGIN).send({ method: 'totp', code: await mfa.freshCode() }).expect(401)).body.code).toBe('MFA_EXPIRED');
    await second.agent.post('/auth/mfa/verify').send({ method: 'sms', code: '123456' }).expect(400);
  });

  it('los códigos de respaldo sirven una sola vez y avisan por correo', async () => {
    const carla = await signUp(ctx, 'carla.mfa', 'Ca#DosPasos2026-ok');
    const { backupCodes } = await enableMfa(ctx, carla);
    const backup = backupCodes[0] ?? '';

    const login = await freshLogin(carla);
    await login.agent.post('/auth/mfa/verify').send({ method: 'backup', code: backup.toLowerCase() }).expect(200);
    expect(ctx.mail.securityAlerts).toContainEqual({ to: carla.email, event: 'backup_code_used' });
    expect(((await carla.agent.get('/auth/mfa').expect(200)).body as MfaStatusDto).backupCodesLeft).toBe(9);

    const again = await freshLogin(carla);
    await again.agent.post('/auth/mfa/verify').send({ method: 'backup', code: backup }).expect(401);
  });

  it('5 códigos incorrectos bloquean la cuenta 15 minutos (sin fuerza bruta de 6 dígitos)', async () => {
    const dani = await signUp(ctx, 'dani.mfa', 'Da#DosPasos2026-ok');
    const mfa = await enableMfa(ctx, dani);
    const login = await freshLogin(dani);
    const good = await mfa.freshCode();
    const bad = good === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt++) await login.agent.post('/auth/mfa/verify').send({ method: 'totp', code: bad }).expect(401);
    expect((await login.agent.post('/auth/mfa/verify').send({ method: 'totp', code: good }).expect(429)).body.code).toBe('ACCOUNT_LOCKED');
    expect((await login.agent.post('/auth/login').send({ identifier: dani.tag, password: dani.password }).expect(429)).body.code).toBe('ACCOUNT_LOCKED');
  });

  it('desactivar o regenerar exige contraseña Y un código vigente', async () => {
    const eva = await signUp(ctx, 'eva.mfa', 'Ev#DosPasos2026-ok');
    const mfa = await enableMfa(ctx, eva);

    await eva.agent.post('/auth/mfa/backup-codes').send({ password: 'Otra#Clave2026-mal', code: await mfa.freshCode() }).expect(403);
    await eva.agent.post('/auth/mfa/backup-codes').send({ password: eva.password, code: '000000' }).expect(400);
    const renewed = (await eva.agent.post('/auth/mfa/backup-codes').send({ password: eva.password, code: await mfa.freshCode() }).expect(200)).body as BackupCodesDto;
    expect(renewed.codes).not.toContain(mfa.backupCodes[0]); // los viejos ya no sirven

    await eva.agent.post('/auth/mfa/totp/disable').send({ password: eva.password }).expect(400);
    await eva.agent.post('/auth/mfa/totp/disable').send({ password: eva.password, code: renewed.codes[0] }).expect(204);
    expect((await eva.agent.get('/auth/mfa').expect(200)).body as MfaStatusDto).toEqual({ enabled: false, totp: false, backupCodesLeft: 0, passkeys: [] });
    expect(ctx.mail.securityAlerts).toContainEqual({ to: eva.email, event: 'mfa_disabled' });
    // Sin 2FA, el login vuelve a ser de un paso.
    expect((await freshLogin(eva)).body.mfaRequired).toBe(false);
  });
});
