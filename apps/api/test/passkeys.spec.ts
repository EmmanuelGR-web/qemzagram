import type { LoginResultDto, MfaStatusDto, PasskeyRegisteredDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { passkeys } from '../src/database/schema';
import { SoftAuthenticator } from './support/soft-authenticator';
import { createTestApp, enableMfa, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Llaves de acceso (passkeys / WebAuthn)', () => {
  let ctx: TestContext;

  const options = async (user: TestUser) => (await user.agent.post('/auth/mfa/passkeys/options').send({ password: user.password }).expect(200)).body as { challenge: string; rp: { id: string } };
  const register = async (user: TestUser, device: SoftAuthenticator, name = 'Mi celular') =>
    (await user.agent.post('/auth/mfa/passkeys').send({ name, response: device.register(await options(user)) }).expect(201)).body as PasskeyRegisteredDto;
  const passwordStep = async (user: TestUser) => {
    const agent = request.agent(ctx.app.getHttpServer()).set('Origin', ORIGIN);
    const body = (await agent.post('/auth/login').send({ identifier: user.tag, password: user.password }).expect(200)).body as LoginResultDto;
    return { agent, body };
  };
  const loginOptions = async (agent: ReturnType<typeof request.agent>) => (await agent.post('/auth/mfa/passkey/options').send({}).expect(200)).body as { challenge: string; allowCredentials: { id: string }[] };

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('registrar exige sesión y contraseña; guarda SOLO la clave pública y entrega códigos de respaldo', async () => {
    const ana = await signUp(ctx, 'ana.llave', 'An#Llaves2026-ok');
    await request(ctx.app.getHttpServer()).post('/auth/mfa/passkeys/options').set('Origin', ORIGIN).send({ password: ana.password }).expect(401);
    await ana.agent.post('/auth/mfa/passkeys/options').send({ password: 'Otra#Clave2026-mal' }).expect(403);

    const opts = await options(ana);
    expect(opts.rp.id).toBe('localhost');
    const device = new SoftAuthenticator(ORIGIN);
    const created = (await ana.agent.post('/auth/mfa/passkeys').send({ name: '  Mi celular ', response: device.register(opts) }).expect(201)).body as PasskeyRegisteredDto;
    expect(created.passkey).toMatchObject({ name: 'Mi celular', lastUsedAt: null });
    expect(created.backupCodes).toHaveLength(10);
    expect(Object.keys(created.passkey).sort()).toEqual(['backedUp', 'createdAt', 'id', 'lastUsedAt', 'name']); // nunca la clave
    expect(ctx.mail.securityAlerts).toContainEqual({ to: ana.email, event: 'passkey_added' });

    const status = (await ana.agent.get('/auth/mfa').expect(200)).body as MfaStatusDto;
    expect(status).toMatchObject({ enabled: true, totp: false, backupCodesLeft: 10 });
    expect(status.passkeys).toHaveLength(1);
    const [row] = await ctx.db.select().from(passkeys).where(eq(passkeys.userId, ana.id));
    expect(row?.credentialId).toBe(device.id);
  });

  it('rechaza respuestas de otro dominio (anti-phishing), desafíos reusados y campos extra', async () => {
    const beto = await signUp(ctx, 'beto.llave', 'Be#Llaves2026-ok');
    const device = new SoftAuthenticator(ORIGIN);

    // Una página falsa (otro origen) no sirve aunque el dispositivo firme.
    const phishing = await options(beto);
    expect((await beto.agent.post('/auth/mfa/passkeys').send({ name: 'x', response: device.register(phishing, { origin: 'https://qemzagram-falso.com' }) }).expect(400)).body.code).toBe('PASSKEY_INVALID');
    // Otro rpID tampoco.
    const otherRp = await options(beto);
    await beto.agent.post('/auth/mfa/passkeys').send({ name: 'x', response: device.register(otherRp, { rpId: 'evil.com' }) }).expect(400);

    // El desafío es de un solo uso.
    const opts = await options(beto);
    const response = device.register(opts);
    await beto.agent.post('/auth/mfa/passkeys').send({ name: 'Llave', response }).expect(201);
    await beto.agent.post('/auth/mfa/passkeys').send({ name: 'Llave', response }).expect(400);

    // Validación estricta de la forma.
    await beto.agent.post('/auth/mfa/passkeys').send({ name: '', response }).expect(400);
    await beto.agent.post('/auth/mfa/passkeys').send({ name: 'x', response: { ...response, type: 'otro' } }).expect(400);
    await beto.agent.post('/auth/mfa/passkeys').send({ name: 'x', response, userId: 'otro' }).expect(400);
  });

  it('login con llave de acceso: firma válida → sesión; firma de otra llave, contador que retrocede o sin contraseña → no', async () => {
    const carla = await signUp(ctx, 'carla.llave', 'Ca#Llaves2026-ok');
    const device = new SoftAuthenticator(ORIGIN);
    await register(carla, device);

    // Sin pasar por la contraseña no hay desafío.
    await request(ctx.app.getHttpServer()).post('/auth/mfa/passkey/options').set('Origin', ORIGIN).send({}).expect(401);

    const first = await passwordStep(carla);
    expect(first.body).toEqual({ mfaRequired: true, methods: ['passkey', 'backup'] });
    const challenge = await loginOptions(first.agent);
    expect(challenge.allowCredentials.map((item) => item.id)).toEqual([device.id]);
    await first.agent.post('/auth/mfa/verify').send({ method: 'passkey', response: device.authenticate(challenge) }).expect(200);
    await first.agent.get('/users/me').expect(200);

    // Una llave que no es de esta cuenta (aunque firme bien) no sirve.
    const stranger = new SoftAuthenticator(ORIGIN);
    const second = await passwordStep(carla);
    expect((await second.agent.post('/auth/mfa/verify').send({ method: 'passkey', response: stranger.authenticate(await loginOptions(second.agent)) }).expect(401)).body.code).toBe('INVALID_CODE');

    // Contador que retrocede = posible llave clonada.
    const third = await passwordStep(carla);
    await third.agent.post('/auth/mfa/verify').send({ method: 'passkey', response: device.authenticate(await loginOptions(third.agent), { counter: 1 }) }).expect(401);

    // Firma desde un sitio falso.
    const fourth = await passwordStep(carla);
    await fourth.agent.post('/auth/mfa/verify').send({ method: 'passkey', response: device.authenticate(await loginOptions(fourth.agent), { origin: 'https://phishing.example' }) }).expect(401);

    // La llave registra su último uso.
    const status = (await carla.agent.get('/auth/mfa').expect(200)).body as MfaStatusDto;
    expect(status.passkeys[0]?.lastUsedAt).not.toBeNull();
  });

  it('quitar la última llave apaga el 2FA (si no hay TOTP) y borra los códigos de respaldo', async () => {
    const dani = await signUp(ctx, 'dani.llave', 'Da#Llaves2026-ok');
    const created = await register(dani, new SoftAuthenticator(ORIGIN));
    const otro = await signUp(ctx, 'otro.llave', 'Ot#Llaves2026-ok');
    await otro.agent.post(`/auth/mfa/passkeys/${created.passkey.id}/delete`).send({ password: otro.password }).expect(404); // no es suya

    await dani.agent.post(`/auth/mfa/passkeys/${created.passkey.id}/delete`).send({ password: 'Otra#Clave2026-mal' }).expect(403);
    await dani.agent.post(`/auth/mfa/passkeys/${created.passkey.id}/delete`).send({ password: dani.password }).expect(204);
    expect((await dani.agent.get('/auth/mfa').expect(200)).body as MfaStatusDto).toEqual({ enabled: false, totp: false, backupCodesLeft: 0, passkeys: [] });
    expect(ctx.mail.securityAlerts).toContainEqual({ to: dani.email, event: 'passkey_removed' });
  });

  it('con TOTP y llave: quitar la llave mantiene el 2FA; desactivar TOTP con llave lo mantiene también', async () => {
    const eva = await signUp(ctx, 'eva.llave', 'Ev#Llaves2026-ok');
    const mfa = await enableMfa(ctx, eva);
    const created = await register(eva, new SoftAuthenticator(ORIGIN));
    expect(created.backupCodes).toBeNull(); // ya tenía códigos del TOTP

    await eva.agent.post('/auth/mfa/totp/disable').send({ password: eva.password, code: await mfa.freshCode() }).expect(204);
    expect((await eva.agent.get('/auth/mfa').expect(200)).body as MfaStatusDto).toMatchObject({ enabled: true, totp: false, backupCodesLeft: 10 });
    await eva.agent.post(`/auth/mfa/passkeys/${created.passkey.id}/delete`).send({ password: eva.password }).expect(204);
    expect(((await eva.agent.get('/auth/mfa').expect(200)).body as MfaStatusDto).enabled).toBe(false);
  });
});
