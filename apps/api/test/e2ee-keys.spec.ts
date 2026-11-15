import {
  E2EE_BACKUP_MIN_ITERATIONS,
  decryptKeyBackup,
  encryptKeyBackup,
  generateIdentity,
  generateRecoveryCode,
  keyFingerprint,
  normalizeRecoveryCode,
  toBase64Url,
  type ConversationDto,
  type ConversationKeysDto,
  type E2eeKeyDto,
  type MyE2eeKeyDto,
} from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { auditLog, e2eeKeys } from '../src/database/schema';
import { setupE2ee } from './support/e2ee-client';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Cifrado de extremo a extremo: claves de cuenta y código de recuperación', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let chatAnaBeto: string;

  const befriend = async (a: TestUser, b: TestUser) => {
    await a.agent.post('/contacts').send({ tag: b.tag }).expect(201);
    await b.agent.post('/contacts').send({ tag: a.tag }).expect(201);
  };
  const newKeyBody = async (user: TestUser, code = generateRecoveryCode()) => {
    const identity = await generateIdentity();
    return { publicKey: identity.publicJwk, backup: await encryptKeyBackup(identity.privateKey, user.id, code, E2EE_BACKUP_MIN_ITERATIONS) };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.e2ee', 'An#Cifrado2026-ok');
    beto = await signUp(ctx, 'beto.e2ee', 'Be#Cifrado2026-ok');
    carla = await signUp(ctx, 'carla.e2ee', 'Ca#Cifrado2026-ok');
    await befriend(ana, beto);
    chatAnaBeto = ((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200)).body as ConversationDto).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('exige sesión en todas las rutas', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).get('/e2ee/keys/me').set('Origin', ORIGIN).expect(401);
    await request(server).post('/e2ee/keys').set('Origin', ORIGIN).send(await newKeyBody(ana)).expect(401);
    await request(server).post('/e2ee/keys/lookup').set('Origin', ORIGIN).send({ ids: [crypto.randomUUID()] }).expect(401);
    await request(server).get(`/e2ee/conversations/${chatAnaBeto}/keys`).set('Origin', ORIGIN).expect(401);
  });

  it('rechaza claves inválidas, partes privadas y copias débiles', async () => {
    const valid = await newKeyBody(ana);
    // Un punto que no está en la curva.
    const offCurve = { ...valid.publicKey, y: toBase64Url(new Uint8Array(32).fill(7)) };
    await ana.agent.post('/e2ee/keys').send({ ...valid, publicKey: offCurve }).expect(400);
    // Nunca se acepta la parte privada (lista cerrada de campos).
    await ana.agent.post('/e2ee/keys').send({ ...valid, publicKey: { ...valid.publicKey, d: valid.publicKey.x } }).expect(400);
    await ana.agent.post('/e2ee/keys').send({ ...valid, backup: { ...valid.backup, iterations: 1000 } }).expect(400);
    await ana.agent.post('/e2ee/keys').send({ ...valid, userId: beto.id }).expect(400);
    await ana.agent.post('/e2ee/keys').send({ publicKey: valid.publicKey }).expect(400);
    expect((await ana.agent.get('/e2ee/keys/me').expect(200)).body).toEqual({ key: null, backup: null });
  });

  it('la copia se abre SOLO con el código correcto y en la cuenta correcta (dispositivo nuevo)', async () => {
    const device = await setupE2ee(ana);
    const mine = (await ana.agent.get('/e2ee/keys/me').expect(200)).body as MyE2eeKeyDto;
    expect(mine.key).toMatchObject({ id: device.keyId, userId: ana.id, active: true, publicKey: device.publicJwk });
    expect(mine.backup).not.toBeNull();
    if (!mine.backup) return;
    // El servidor nunca guarda la clave privada en claro.
    expect(JSON.stringify(mine)).not.toContain('"d"');

    // "Dispositivo nuevo": con el código (aunque lo escriban en minúsculas y con espacios) recupera la misma clave.
    const typed = device.recoveryCode.toLowerCase().replace(/-/g, ' ');
    const restored = await decryptKeyBackup(mine.backup, ana.id, typed);
    expect(restored.publicJwk).toEqual(device.publicJwk);
    expect(restored.privateKey.extractable).toBe(false);

    await expect(decryptKeyBackup(mine.backup, ana.id, generateRecoveryCode())).rejects.toMatchObject({ code: 'BAD_CODE' });
    // La copia está atada a la cuenta: no sirve para otra persona aunque tenga el código.
    await expect(decryptKeyBackup(mine.backup, beto.id, device.recoveryCode)).rejects.toMatchObject({ code: 'BAD_CODE' });
    expect(normalizeRecoveryCode('corto')).toBeNull();
    expect(await keyFingerprint(device.publicJwk)).toMatch(/^(\d{5} ){7}\d{5}$/);
  });

  it('cambiar las claves exige la contraseña, avisa por correo y deja la anterior solo para verificar', async () => {
    const before = (await ana.agent.get('/e2ee/keys/me').expect(200)).body as MyE2eeKeyDto;
    const body = await newKeyBody(ana);
    await ana.agent.post('/e2ee/keys').send(body).expect(409);
    await ana.agent.post('/e2ee/keys').send({ ...body, password: 'Otra#Clave2026-mal' }).expect(403);
    const replaced = (await ana.agent.post('/e2ee/keys').send({ ...body, password: ana.password }).expect(201)).body as MyE2eeKeyDto;
    expect(replaced.key?.id).not.toBe(before.key?.id);

    const rows = await ctx.db.select().from(e2eeKeys).where(eq(e2eeKeys.userId, ana.id));
    const old = rows.find((row) => row.id === before.key?.id);
    expect(old?.revokedAt).not.toBeNull();
    expect(old?.backup).toBeNull();
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    expect(ctx.mail.securityAlerts).toContainEqual({ to: ana.email, event: 'e2ee_key_reset' });
    const audit = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'e2ee.key_reset'));
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(body.backup.ct);
  });

  it('claves de una conversación: solo para miembros, y null para quien no activó el cifrado', async () => {
    const response = await ana.agent.get(`/e2ee/conversations/${chatAnaBeto}/keys`).expect(200);
    const keys = (response.body as ConversationKeysDto).members;
    expect(keys.find((member) => member.userId === ana.id)?.key?.active).toBe(true);
    expect(keys.find((member) => member.userId === beto.id)?.key).toBeNull();
    // Quien no es miembro recibe "no encontrado" (no se revela que existe).
    await carla.agent.get(`/e2ee/conversations/${chatAnaBeto}/keys`).expect(404);
    await ana.agent.get(`/e2ee/conversations/${crypto.randomUUID()}/keys`).expect(404);
    await ana.agent.get('/e2ee/conversations/no-es-uuid/keys').expect(400);
  });

  it('buscar claves por id: las propias y las de quien comparte un chat (también las viejas); las de extraños no', async () => {
    const betoDevice = await setupE2ee(beto);
    const carlaDevice = await setupE2ee(carla);
    const anaKeys = await ctx.db.select().from(e2eeKeys).where(eq(e2eeKeys.userId, ana.id));
    const ids = [...anaKeys.map((row) => row.id), betoDevice.keyId, carlaDevice.keyId];

    const seenByBeto = (await beto.agent.post('/e2ee/keys/lookup').send({ ids }).expect(200)).body as E2eeKeyDto[];
    expect(seenByBeto.map((key) => key.id).sort()).toEqual([...anaKeys.map((row) => row.id), betoDevice.keyId].sort());
    expect(seenByBeto.filter((key) => key.userId === ana.id && !key.active)).toHaveLength(1);

    const seenByCarla = (await carla.agent.post('/e2ee/keys/lookup').send({ ids }).expect(200)).body as E2eeKeyDto[];
    expect(seenByCarla.map((key) => key.id)).toEqual([carlaDevice.keyId]);
    await carla.agent.post('/e2ee/keys/lookup').send({ ids: [] }).expect(400);
    await carla.agent.post('/e2ee/keys/lookup').send({ ids: Array.from({ length: 51 }, () => crypto.randomUUID()) }).expect(400);
  });

  it('al dar de baja la cuenta se revocan sus claves y se borran sus copias', async () => {
    const dana = await signUp(ctx, 'dana.e2ee', 'Da#Cifrado2026-ok');
    await befriend(ana, dana);
    const chat = ((await ana.agent.post('/chats/direct').send({ tag: dana.tag }).expect(200)).body as ConversationDto).id;
    await setupE2ee(dana);
    await dana.agent.post('/users/me/delete').send({ password: dana.password }).expect(204);
    const rows = await ctx.db.select().from(e2eeKeys).where(eq(e2eeKeys.userId, dana.id));
    expect(rows.every((row) => row.revokedAt !== null && row.backup === null)).toBe(true);
    const keys = (await ana.agent.get(`/e2ee/conversations/${chat}/keys`).expect(200)).body as ConversationKeysDto;
    // La cuenta dada de baja ya no figura entre los destinatarios.
    expect(keys.members.some((member) => member.userId === dana.id)).toBe(false);
  });
});
