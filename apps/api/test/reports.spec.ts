import { REPORTS_PER_DAY, type ConversationDto, type MessageDto, type MyReportDto, type StatusDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { CryptoService } from '../src/common/crypto.service';
import { ReportsRepository } from '../src/database/repositories/reports.repository';
import { auditLog, reportEvidence, reports } from '../src/database/schema';
import { evidenceAad } from '../src/reports/reports.service';
import { BlobStorage } from '../src/storage/blob-storage.port';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Denuncias con evidencia', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let chatAnaBeto: string;
  let chatBetoCarla: string;

  const befriend = async (a: TestUser, b: TestUser) => {
    await a.agent.post('/contacts').send({ tag: b.tag }).expect(201);
    await b.agent.post('/contacts').send({ tag: a.tag }).expect(201);
  };
  const say = async (user: TestUser, chatId: string, body: string) =>
    ((await user.agent.post(`/chats/${chatId}/messages`).send({ body }).expect(201)).body as MessageDto).id;
  const report = (user: TestUser, body: Record<string, unknown>) => user.agent.post('/reports').send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.denuncia', 'An#Denuncia2026-ok');
    beto = await signUp(ctx, 'beto.denuncia', 'Be#Denuncia2026-ok');
    carla = await signUp(ctx, 'carla.denuncia', 'Ca#Denuncia2026-ok');
    await befriend(ana, beto);
    await befriend(beto, carla);
    chatAnaBeto = ((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200)).body as ConversationDto).id;
    chatBetoCarla = ((await beto.agent.post('/chats/direct').send({ tag: carla.tag }).expect(200)).body as ConversationDto).id;
  });
  beforeEach(async () => {
    await ctx.db.delete(reports);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('exige sesión y valida la entrada (lista cerrada de campos y motivos)', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).post('/reports').set('Origin', ORIGIN).send({ userId: beto.id, reason: 'spam' }).expect(401);
    await request(server).get('/reports/mine').set('Origin', ORIGIN).expect(401);

    await report(ana, { userId: beto.id }).expect(400);
    await report(ana, { userId: beto.id, reason: 'me-cae-mal' }).expect(400);
    await report(ana, { userId: 'x', reason: 'spam' }).expect(400);
    await report(ana, { userId: beto.id, reason: 'spam', status: 'confirmed' }).expect(400);
    await report(ana, { userId: beto.id, reason: 'spam', reporterId: carla.id }).expect(400);
    await report(ana, { userId: beto.id, reason: 'spam', description: 'x'.repeat(1001) }).expect(400);
    const many = Array.from({ length: 11 }, () => ({ type: 'message', id: crypto.randomUUID() }));
    await report(ana, { userId: beto.id, reason: 'spam', evidence: many }).expect(400);
    const repeated = { type: 'message', id: crypto.randomUUID() };
    await report(ana, { userId: beto.id, reason: 'spam', evidence: [repeated, repeated] }).expect(400);
    await report(ana, { userId: ana.id, reason: 'spam' }).expect(400);
    await report(ana, { userId: '00000000-0000-4000-8000-000000000000', reason: 'spam' }).expect(404);
  });

  it('copia CIFRADA la evidencia elegida (texto e imagen) y quien denuncia no ve la decisión', async () => {
    const insult = await say(beto, chatAnaBeto, 'Mensaje ofensivo de prueba');
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#000' } }).png().toBuffer();
    const image = (
      await beto.agent.post(`/chats/${chatAnaBeto}/attachments`).field('kind', 'image').attach('file', photo, { filename: 'a.png', contentType: 'image/png' }).expect(201)
    ).body as MessageDto;
    const status = (await beto.agent.post('/statuses/text').send({ body: 'Estado ofensivo', background: 'rojo' }).expect(201)).body as StatusDto;

    const created = (
      await report(ana, {
        userId: beto.id,
        reason: 'harassment',
        description: '  Me escribe a la noche  ',
        evidence: [
          { type: 'message', id: insult },
          { type: 'message', id: image.id },
          { type: 'status', id: status.id },
        ],
      }).expect(201)
    ).body as MyReportDto;
    expect(created).toMatchObject({ reason: 'harassment', reviewed: false, evidenceCount: 3, user: { id: beto.id } });

    // En la base todo está cifrado: ni la descripción ni el texto aparecen en claro.
    const [row] = await ctx.db.select().from(reports).where(eq(reports.id, created.id));
    expect(row?.descriptionEncrypted).not.toContain('noche');
    const evidence = await ctx.app.get(ReportsRepository).evidenceFor(created.id);
    expect(evidence.map((item) => item.kind).sort()).toEqual(['image', 'text', 'text']);
    const crypto = ctx.app.get(CryptoService);
    const text = evidence.find((item) => item.source === 'message' && item.kind === 'text');
    expect(text?.bodyEncrypted).not.toContain('ofensivo');
    expect(crypto.decryptText(text?.bodyEncrypted ?? '', evidenceAad(text?.id ?? ''))).toBe('Mensaje ofensivo de prueba');

    // El archivo es una COPIA con clave propia: no depende del original.
    const copy = evidence.find((item) => item.kind === 'image');
    expect(copy?.storageKey).toBeTruthy();
    const stored = await ctx.app.get(BlobStorage).get(copy?.storageKey ?? '');
    expect(crypto.decryptBlob(stored ?? Buffer.alloc(0), evidenceAad(copy?.id ?? '')).length).toBeGreaterThan(0);

    const mine = (await ana.agent.get('/reports/mine').expect(200)).body as MyReportDto[];
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0] ?? {}).sort()).toEqual(['createdAt', 'evidenceCount', 'id', 'reason', 'reviewed', 'user']);
    expect((await beto.agent.get('/reports/mine').expect(200)).body).toEqual([]); // el denunciado no se entera
    expect((await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'report.created'))).length).toBeGreaterThan(0);
  });

  it('solo acepta como evidencia lo que quien denuncia puede ver y escribió la persona denunciada', async () => {
    const own = await say(ana, chatAnaBeto, 'Esto lo escribí yo');
    const foreignChat = await say(beto, chatBetoCarla, 'Chat al que ana no pertenece');
    const fromCarla = await say(carla, chatBetoCarla, 'Lo escribió carla');

    const invalid = [
      { type: 'message', id: own }, // no lo escribió beto
      { type: 'message', id: foreignChat }, // ana no es miembro de ese chat
      { type: 'message', id: crypto.randomUUID() }, // no existe
      { type: 'status', id: crypto.randomUUID() },
    ];
    for (const item of invalid) {
      expect((await report(ana, { userId: beto.id, reason: 'spam', evidence: [item] }).expect(400)).body.code).toBe('INVALID_EVIDENCE');
    }
    // Nada quedó guardado de los intentos inválidos.
    expect(await ctx.db.select().from(reportEvidence)).toHaveLength(0);
    // En cambio beto sí puede usar el mensaje de carla: es miembro de ese chat y ella lo escribió.
    await report(beto, { userId: carla.id, reason: 'spam', evidence: [{ type: 'message', id: fromCarla }] }).expect(201);
  });

  it('una denuncia pendiente por persona y un máximo por día', async () => {
    await report(ana, { userId: beto.id, reason: 'spam' }).expect(201);
    expect((await report(ana, { userId: beto.id, reason: 'hate' }).expect(409)).body.code).toBe('REPORT_ALREADY_OPEN');
    await report(carla, { userId: beto.id, reason: 'spam' }).expect(201); // otra persona sí puede

    const spy = jest.spyOn(ctx.app.get(ReportsRepository), 'countSentSince').mockResolvedValueOnce(REPORTS_PER_DAY);
    expect((await report(ana, { userId: carla.id, reason: 'spam' }).expect(429)).body.code).toBe('REPORTS_DAILY_LIMIT');
    spy.mockRestore();
  });
});
