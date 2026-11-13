import type { StatusDto, StatusOverviewDto, StatusViewDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { statuses } from '../src/database/schema';
import { RealtimePublisher } from '../src/realtime/realtime.port';
import { storedFiles } from './support/files';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Estados: visto por, borrar y avisos en tiempo real', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let dani: TestUser;
  let toUsers: jest.SpyInstance;

  const overview = async (user: TestUser) => (await user.agent.get('/statuses').expect(200)).body as StatusOverviewDto;
  const postText = async (user: TestUser, body: string) =>
    (await user.agent.post('/statuses/text').send({ body, background: 'rojo' }).expect(201)).body as StatusDto;
  /** Usuarios que recibieron el último aviso "status:changed". */
  const lastNotified = (): string[] => {
    const call = toUsers.mock.calls.filter((args: unknown[]) => args[1] === 'status:changed').at(-1) as [string[], string, unknown] | undefined;
    return [...(call?.[0] ?? [])].sort();
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    toUsers = jest.spyOn(ctx.app.get(RealtimePublisher), 'toUsers');
    ana = await signUp(ctx, 'ana.vis', 'An#Vistos2026-ok');
    beto = await signUp(ctx, 'beto.vis', 'Be#Vistos2026-ok');
    carla = await signUp(ctx, 'carla.vis', 'Ca#Vistos2026-ok');
    dani = await signUp(ctx, 'dani.vis', 'Da#Vistos2026-ok');
    for (const other of [beto, carla]) {
      await ana.agent.post('/contacts').send({ tag: other.tag }).expect(201);
      await other.agent.post('/contacts').send({ tag: ana.tag }).expect(201);
    }
    await dani.agent.post('/contacts').send({ tag: ana.tag }).expect(201); // no es mutuo
  });
  afterAll(async () => {
    toUsers.mockRestore();
    await ctx.close();
  });

  it('avisa en tiempo real SOLO a la audiencia (y a la propia persona), sin enviar contenido', async () => {
    await postText(ana, 'Aviso a mi agenda');
    expect(lastNotified()).toEqual([ana.id, beto.id, carla.id].sort());
    const call = toUsers.mock.calls.filter((args: unknown[]) => args[1] === 'status:changed').at(-1) as unknown[];
    expect(call[2]).toEqual({ ownerId: ana.id }); // sin texto ni URL

    // Con "excepto Carla", Carla deja de recibir avisos de estados nuevos…
    await ana.agent.put('/statuses/privacy').send({ audience: 'except', except: ['carla.vis'], only: [] }).expect(200);
    // …pero sí recibe el aviso del cambio, para que su lista se actualice.
    expect(lastNotified()).toContain(carla.id);
    await postText(ana, 'Sin Carla');
    expect(lastNotified()).toEqual([ana.id, beto.id].sort());
    expect(lastNotified()).not.toContain(dani.id);
    await ana.agent.put('/statuses/privacy').send({ audience: 'contacts', except: [], only: [] }).expect(200);
  });

  it('registra quién vio cada estado; solo el dueño ve la lista', async () => {
    const status = await postText(ana, 'Quién me ve');
    let forBeto = await overview(beto);
    const item = forBeto.feed.find((entry) => entry.user.id === ana.id);
    expect(item?.allViewed).toBe(false);
    expect(item?.statuses.find((entry) => entry.id === status.id)).toMatchObject({ viewed: false, viewCount: null });

    await beto.agent.post(`/statuses/${status.id}/view`).expect(204);
    await beto.agent.post(`/statuses/${status.id}/view`).expect(204); // repetir no duplica
    await ana.agent.post(`/statuses/${status.id}/view`).expect(204); // ver el propio no cuenta

    forBeto = await overview(beto);
    expect(forBeto.feed.find((entry) => entry.user.id === ana.id)?.statuses.find((entry) => entry.id === status.id)?.viewed).toBe(true);

    const mine = (await overview(ana)).mine.find((entry) => entry.id === status.id);
    expect(mine).toMatchObject({ viewed: true, viewCount: 1 });
    const views = (await ana.agent.get(`/statuses/${status.id}/views`).expect(200)).body as StatusViewDto[];
    expect(views.map((view) => view.user.tag)).toEqual(['beto.vis']);

    // Nadie más puede ver la lista ni saber si el estado existe.
    await beto.agent.get(`/statuses/${status.id}/views`).expect(404);
    await dani.agent.get(`/statuses/${status.id}/views`).expect(404);
  });

  it('no se puede marcar como visto un estado que no te corresponde', async () => {
    const status = await postText(ana, 'Solo agenda mutua');
    await dani.agent.post(`/statuses/${status.id}/view`).expect(404);
    await ana.agent.put('/statuses/privacy').send({ audience: 'only', except: [], only: ['carla.vis'] }).expect(200);
    await beto.agent.post(`/statuses/${status.id}/view`).expect(404);
    await ana.agent.put('/statuses/privacy').send({ audience: 'contacts', except: [], only: [] }).expect(200);

    await beto.agent.post('/statuses/no-es-un-uuid/view').expect(400);
    await request(ctx.app.getHttpServer()).post(`/statuses/${status.id}/view`).set('Origin', ORIGIN).expect(401);
  });

  it('el dueño puede borrar su estado (con su archivo); nadie más puede', async () => {
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#b8132a' } }).png().toBuffer();
    const status = (await ana.agent.post('/statuses/media').field('kind', 'image').attach('file', image, 'foto.png').expect(201)).body as StatusDto;
    await beto.agent.post(`/statuses/${status.id}/view`).expect(204);
    const before = storedFiles().length;

    await beto.agent.delete(`/statuses/${status.id}`).expect(404);
    await carla.agent.delete(`/statuses/${status.id}`).expect(404);

    await ana.agent.delete(`/statuses/${status.id}`).expect(204);
    expect(storedFiles().length).toBe(before - 1);
    expect(lastNotified()).toEqual([ana.id, beto.id, carla.id].sort());
    await beto.agent.get(status.media?.url ?? '').expect(404);
    await ana.agent.delete(`/statuses/${status.id}`).expect(404);
    await ana.agent.get(`/statuses/${status.id}/views`).expect(404);
  });

  it('dar de baja la cuenta borra al instante sus estados y archivos', async () => {
    const eva = await signUp(ctx, 'eva.vis', 'Ev#Vistos2026-ok');
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#d91e36' } }).png().toBuffer();
    await eva.agent.post('/statuses/media').field('kind', 'image').attach('file', image, 'foto.png').expect(201);
    await postText(eva, 'Me voy');
    const before = storedFiles().length;

    await eva.agent.post('/users/me/delete').send({ password: eva.password }).expect(204);
    expect(await ctx.db.select().from(statuses).where(eq(statuses.ownerId, eva.id))).toEqual([]);
    expect(storedFiles().length).toBe(before - 1);
  });
});
