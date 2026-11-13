import { STATUS_ACTIVE_MAX, STATUS_TEXT_MAX_LENGTH, type StatusDto, type StatusOverviewDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { statuses } from '../src/database/schema';
import { StatusesCleanupService } from '../src/statuses/statuses-cleanup.service';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Estados (24 horas)', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let dani: TestUser;

  const overview = async (user: TestUser) => (await user.agent.get('/statuses').expect(200)).body as StatusOverviewDto;
  const postText = (user: TestUser, body: string, background = 'rojo') => user.agent.post('/statuses/text').send({ body, background });
  const expire = (id: string) =>
    ctx.db
      .update(statuses)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(statuses.id, id));

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.est', 'An#Estados2026-ok');
    beto = await signUp(ctx, 'beto.est', 'Be#Estados2026-ok');
    carla = await signUp(ctx, 'carla.est', 'Ca#Estados2026-ok');
    dani = await signUp(ctx, 'dani.est', 'Da#Estados2026-ok');
    // Ana y Beto se agregaron mutuamente.
    await ana.agent.post('/contacts').send({ tag: 'beto.est' }).expect(201);
    await beto.agent.post('/contacts').send({ tag: 'ana.est' }).expect(201);
    // Ana agregó a Carla, pero Carla NO agregó a Ana.
    await ana.agent.post('/contacts').send({ tag: 'carla.est' }).expect(201);
    // Dani agregó a Ana, pero Ana NO agregó a Dani.
    await dani.agent.post('/contacts').send({ tag: 'ana.est' }).expect(201);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('exige sesión', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).get('/statuses').set('Origin', ORIGIN).expect(401);
    await request(server).post('/statuses/text').set('Origin', ORIGIN).send({ body: 'hola', background: 'rojo' }).expect(401);
  });

  it('publica un estado de texto que vence a las 24 horas y guarda el texto cifrado', async () => {
    const created = (await postText(ana, '  Hoy arranca la Fase 3 🔴  ', 'vino').expect(201)).body as StatusDto;
    expect(created).toMatchObject({ kind: 'text', body: 'Hoy arranca la Fase 3 🔴', background: 'vino', media: null, ownerId: ana.id });
    const lifetime = new Date(created.expiresAt).getTime() - new Date(created.createdAt).getTime();
    expect(lifetime).toBe(24 * 60 * 60 * 1000);

    const [row] = await ctx.db.select().from(statuses).where(eq(statuses.id, created.id));
    expect(row?.bodyEncrypted).toBeDefined();
    expect(row?.bodyEncrypted).not.toContain('Fase 3');

    expect((await overview(ana)).mine.map((status) => status.id)).toContain(created.id);
  });

  it('valida el texto y el fondo (lista cerrada, sin campos extra)', async () => {
    await postText(ana, '   ').expect(400);
    await postText(ana, 'x'.repeat(STATUS_TEXT_MAX_LENGTH + 1)).expect(400);
    await postText(ana, 'hola', 'url(javascript:alert(1))').expect(400);
    await ana.agent.post('/statuses/text').send({ body: 'hola', background: 'rojo', ownerId: beto.id }).expect(400);
    await ana.agent.post('/statuses/text').send({ body: 'hola', background: 'rojo', expiresAt: '2099-01-01T00:00:00Z' }).expect(400);
    await ana.agent.post('/statuses/text').send({}).expect(400);
  });

  it('solo los ven contactos MUTUOS: ni quien no te agregó ni quien vos no agregaste', async () => {
    const created = (await postText(ana, 'Solo para mi agenda').expect(201)).body as StatusDto;

    const forBeto = await overview(beto);
    expect(forBeto.feed).toHaveLength(1);
    expect(forBeto.feed[0]?.user.tag).toBe('ana.est');
    expect(forBeto.feed[0]?.statuses.map((status) => status.id)).toContain(created.id);
    expect(forBeto.mine).toEqual([]);

    expect((await overview(carla)).feed).toEqual([]); // Ana la agregó, pero ella no a Ana
    expect((await overview(dani)).feed).toEqual([]); // Dani agregó a Ana, pero Ana no a Dani
  });

  it('un estado vencido desaparece aunque la limpieza no haya corrido, y la limpieza lo borra', async () => {
    const created = (await postText(ana, 'Me voy a vencer').expect(201)).body as StatusDto;
    await expire(created.id);

    expect((await overview(ana)).mine.map((status) => status.id)).not.toContain(created.id);
    const betoFeed = (await overview(beto)).feed.flatMap((item) => item.statuses.map((status) => status.id));
    expect(betoFeed).not.toContain(created.id);

    const purged = await ctx.app.get(StatusesCleanupService).purgeExpired();
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await ctx.db.select().from(statuses).where(eq(statuses.id, created.id))).toEqual([]);
  });

  it('una cuenta pausada no muestra sus estados', async () => {
    const eva = await signUp(ctx, 'eva.est', 'Ev#Estados2026-ok');
    await eva.agent.post('/contacts').send({ tag: 'beto.est' }).expect(201);
    await beto.agent.post('/contacts').send({ tag: 'eva.est' }).expect(201);
    await postText(eva, 'Estado de Eva').expect(201);
    expect((await overview(beto)).feed.map((item) => item.user.tag)).toContain('eva.est');

    await eva.agent.post('/users/me/pause').send({ password: eva.password }).expect(204);
    expect((await overview(beto)).feed.map((item) => item.user.tag)).not.toContain('eva.est');
  });

  it(`limita a ${STATUS_ACTIVE_MAX} estados vigentes por persona`, async () => {
    const already = (await overview(carla)).mine.length;
    for (let index = already; index < STATUS_ACTIVE_MAX; index++) await postText(carla, `Estado ${index}`).expect(201);
    const blocked = await postText(carla, 'Uno de más').expect(400);
    expect((blocked.body as { code: string }).code).toBe('STATUS_LIMIT');
  });
});
