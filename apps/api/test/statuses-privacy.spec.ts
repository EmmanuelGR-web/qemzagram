import type { StatusDto, StatusOverviewDto, StatusPrivacyDto } from '@qemzagram/shared';
import sharp from 'sharp';
import request from 'supertest';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Estados: quién puede verlos', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let dani: TestUser;
  let photo: StatusDto;

  const sees = async (viewer: TestUser, owner: TestUser) =>
    ((await viewer.agent.get('/statuses').expect(200)).body as StatusOverviewDto).feed.some((item) => item.user.id === owner.id);
  const setPrivacy = (user: TestUser, body: Record<string, unknown>) => user.agent.put('/statuses/privacy').send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.priv', 'An#Privacidad2026');
    beto = await signUp(ctx, 'beto.priv', 'Be#Privacidad2026');
    carla = await signUp(ctx, 'carla.priv', 'Ca#Privacidad2026');
    dani = await signUp(ctx, 'dani.priv', 'Da#Privacidad2026');
    // Ana ↔ Beto y Ana ↔ Carla son contactos mutuos. Dani no está en la agenda de Ana.
    for (const other of [beto, carla]) {
      await ana.agent.post('/contacts').send({ tag: other.tag }).expect(201);
      await other.agent.post('/contacts').send({ tag: ana.tag }).expect(201);
    }
    await dani.agent.post('/contacts').send({ tag: ana.tag }).expect(201);

    await ana.agent.post('/statuses/text').send({ body: 'Hola agenda', background: 'coral' }).expect(201);
    const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#d91e36' } }).png().toBuffer();
    photo = (await ana.agent.post('/statuses/media').field('kind', 'image').attach('file', image, 'foto.png').expect(201)).body as StatusDto;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('por defecto: toda mi agenda (mutua), con las listas vacías', async () => {
    const privacy = (await ana.agent.get('/statuses/privacy').expect(200)).body as StatusPrivacyDto;
    expect(privacy).toEqual({ audience: 'contacts', except: [], only: [] });
    expect(await sees(beto, ana)).toBe(true);
    expect(await sees(carla, ana)).toBe(true);
  });

  it('"Mi agenda excepto…": la persona excluida no ve los estados ni puede bajar el archivo', async () => {
    const saved = (await setPrivacy(ana, { audience: 'except', except: ['@beto.priv'], only: [] }).expect(200)).body as StatusPrivacyDto;
    expect(saved.audience).toBe('except');
    expect(saved.except.map((user) => user.tag)).toEqual(['beto.priv']);

    expect(await sees(beto, ana)).toBe(false);
    await beto.agent.get(photo.media?.url ?? '').expect(404);
    expect(await sees(carla, ana)).toBe(true);
    await carla.agent.get(photo.media?.url ?? '').expect(200);
  });

  it('"Solo compartir con…": solo las personas elegidas; la otra lista se conserva', async () => {
    const saved = (await setPrivacy(ana, { audience: 'only', except: ['beto.priv'], only: ['carla.priv'] }).expect(200)).body as StatusPrivacyDto;
    expect(saved.only.map((user) => user.tag)).toEqual(['carla.priv']);
    expect(saved.except.map((user) => user.tag)).toEqual(['beto.priv']);

    expect(await sees(carla, ana)).toBe(true);
    expect(await sees(beto, ana)).toBe(false);

    // Con la lista vacía, nadie ve los estados.
    await setPrivacy(ana, { audience: 'only', except: [], only: [] }).expect(200);
    expect(await sees(carla, ana)).toBe(false);
    await carla.agent.get(photo.media?.url ?? '').expect(404);
  });

  it('las listas no sirven para mostrarle estados a quien no es contacto mutuo', async () => {
    // Dani agregó a Ana, pero Ana no a Dani: no se puede elegir (no está en la agenda de Ana).
    const rejected = await setPrivacy(ana, { audience: 'only', except: [], only: ['dani.priv'] }).expect(400);
    expect((rejected.body as { code: string }).code).toBe('INVALID_MEMBERS');
    await setPrivacy(ana, { audience: 'only', except: [], only: ['no.existe'] }).expect(400);
    expect(await sees(dani, ana)).toBe(false);
  });

  it('valida la entrada y exige sesión', async () => {
    await setPrivacy(ana, { audience: 'todos', except: [], only: [] }).expect(400);
    await setPrivacy(ana, { audience: 'contacts' }).expect(400);
    await setPrivacy(ana, { audience: 'contacts', except: [], only: [], ownerId: beto.id }).expect(400);
    await setPrivacy(ana, { audience: 'contacts', except: ['../x'], only: [] }).expect(400);
    const server = ctx.app.getHttpServer();
    await request(server).get('/statuses/privacy').set('Origin', ORIGIN).expect(401);
    await request(server).put('/statuses/privacy').set('Origin', ORIGIN).send({ audience: 'contacts', except: [], only: [] }).expect(401);
  });

  it('cada persona ve y cambia SOLO su propia configuración', async () => {
    await setPrivacy(ana, { audience: 'except', except: ['carla.priv'], only: [] }).expect(200);
    const forBeto = (await beto.agent.get('/statuses/privacy').expect(200)).body as StatusPrivacyDto;
    expect(forBeto).toEqual({ audience: 'contacts', except: [], only: [] });

    // Si Carla sale de la agenda de Ana, deja de figurar en la lista.
    await ana.agent.delete(`/contacts/${carla.id}`).expect(204);
    expect(((await ana.agent.get('/statuses/privacy').expect(200)).body as StatusPrivacyDto).except).toEqual([]);

    await setPrivacy(ana, { audience: 'contacts', except: [], only: [] }).expect(200);
    expect(await sees(beto, ana)).toBe(true);
  });
});
