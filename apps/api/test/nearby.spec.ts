import {
  NEARBY_MAX_CHANGES_PER_DAY,
  NEARBY_MAX_ROW,
  NEARBY_MIN_CHANGE_SECONDS,
  NEARBY_VISIBLE_MINUTES,
  nearbyCellDistanceKm,
  nearbyDistanceBucket,
  toNearbyCell,
  type NearbyCell,
  type NearbyPersonDto,
  type NearbyStatusDto,
} from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { nearbyPresence, userBlocks } from '../src/database/schema';
import { NearbyService } from '../src/nearby/nearby.service';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

/** San Miguel de Tucumán (plaza Independencia) y puntos a distintas distancias. */
const CENTER = { lat: -26.8303, lng: -65.2038 };
const cellAt = (dLat: number, dLng = 0): NearbyCell => toNearbyCell(CENTER.lat + dLat, CENTER.lng + dLng);
const HOME = cellAt(0);

describe('Personas cercanas', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let dani: TestUser;
  let eva: TestUser;
  let fede: TestUser;

  const show = (user: TestUser, cell: NearbyCell, extra: Record<string, unknown> = {}) => user.agent.put('/nearby/me').send({ cell, consent: true, ...extra });
  const nearbyOf = async (user: TestUser) => (await user.agent.get('/nearby').expect(200)).body as NearbyPersonDto[];
  const ids = (people: NearbyPersonDto[]) => people.map((person) => person.user.id);

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.cerca', 'An#Cercanos2026-ok');
    beto = await signUp(ctx, 'beto.cerca', 'Be#Cercanos2026-ok');
    carla = await signUp(ctx, 'carla.cerca', 'Ca#Cercanos2026-ok');
    dani = await signUp(ctx, 'dani.cerca', 'Da#Cercanos2026-ok');
    eva = await signUp(ctx, 'eva.cerca', 'Ev#Cercanos2026-ok');
    fede = await signUp(ctx, 'fede.cerca', 'Fe#Cercanos2026-ok');
  });
  beforeEach(async () => {
    await ctx.db.delete(nearbyPresence);
    await ctx.db.delete(userBlocks);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('la grilla: misma celda a pocos metros, distancias por rangos y nunca exactas', () => {
    expect(toNearbyCell(CENTER.lat + 0.0001, CENTER.lng + 0.0001)).toEqual(toNearbyCell(CENTER.lat, CENTER.lng));
    expect(nearbyDistanceBucket(nearbyCellDistanceKm(HOME, HOME))).toBe('lt2');
    expect(nearbyDistanceBucket(nearbyCellDistanceKm(HOME, cellAt(0.03)))).toBe('2to5'); // ~3,3 km
    expect(nearbyDistanceBucket(nearbyCellDistanceKm(HOME, cellAt(0.065)))).toBe('5to10'); // ~7 km
    expect(nearbyDistanceBucket(nearbyCellDistanceKm(HOME, cellAt(0.36)))).toBeNull(); // ~40 km
    // También funciona del otro lado del antimeridiano y cerca de los polos.
    expect(toNearbyCell(10, 179.9999).col).toBeGreaterThan(0);
    expect(toNearbyCell(89.9, 0).row).toBe(NEARBY_MAX_ROW - 1);
  });

  it('exige sesión, consentimiento explícito y SOLO acepta una celda (nunca coordenadas)', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).get('/nearby').set('Origin', ORIGIN).expect(401);
    await request(server).put('/nearby/me').set('Origin', ORIGIN).send({ cell: HOME, consent: true }).expect(401);

    await ana.agent.put('/nearby/me').send({ cell: HOME }).expect(400); // sin consentimiento
    await ana.agent.put('/nearby/me').send({ cell: HOME, consent: false }).expect(400);
    await show(ana, HOME, { lat: CENTER.lat, lng: CENTER.lng }).expect(400); // coordenadas: rechazadas
    await ana.agent.put('/nearby/me').send({ cell: { ...HOME, lat: CENTER.lat }, consent: true }).expect(400);
    await show(ana, { row: 1.5, col: 3 }).expect(400);
    await show(ana, { row: -1, col: 3 }).expect(400);
    await show(ana, { row: NEARBY_MAX_ROW, col: 0 }).expect(400);
    await show(ana, { row: HOME.row, col: 999_999 }).expect(400);
    await show(ana, HOME, { userId: beto.id }).expect(400);

    // Sin activar la visibilidad no se puede mirar a nadie (nadie mira sin ser visto).
    expect((await ana.agent.get('/nearby').expect(409)).body.code).toBe('NEARBY_NOT_VISIBLE');
  });

  it('muestra solo a quienes están visibles, a menos de 25 km, sin bloqueo y con datos mínimos', async () => {
    const status = (await show(ana, HOME).expect(200)).body as NearbyStatusDto;
    expect(status.visible).toBe(true);
    expect(new Date(status.visibleUntil ?? 0).getTime() - Date.now()).toBeGreaterThan((NEARBY_VISIBLE_MINUTES - 1) * 60_000);

    await show(beto, HOME).expect(200); // misma zona
    await show(carla, cellAt(0.065)).expect(200); // ~7 km
    await show(dani, cellAt(0.36)).expect(200); // ~40 km: fuera del radio
    await show(eva, HOME).expect(200);
    await eva.agent.post('/blocks').send({ userId: ana.id }).expect(204); // eva bloqueó a ana
    // fede no activó nada.

    const people = await nearbyOf(ana);
    expect(ids(people).sort()).toEqual([beto.id, carla.id].sort());
    expect(people.find((person) => person.user.id === beto.id)?.distance).toBe('lt2');
    expect(people.find((person) => person.user.id === carla.id)?.distance).toBe('5to10');
    // Sin tag, sin bio, sin correo, sin portada y sin ninguna coordenada.
    for (const person of people) {
      expect(Object.keys(person).sort()).toEqual(['distance', 'greeting', 'greetingId', 'tag', 'user']);
      expect(person).toMatchObject({ greeting: 'none', greetingId: null, tag: null }); // desconocidos: sin tag
      expect(Object.keys(person.user).sort()).toEqual(['avatarUrl', 'displayName', 'id']);
    }
    expect(ids(await nearbyOf(eva))).not.toContain(ana.id); // el bloqueo vale en las dos direcciones
    expect(ids(await nearbyOf(dani))).toEqual([]);
    await fede.agent.get('/nearby').expect(409);
  });

  it('modo invisible: deja de aparecer y se BORRA la zona guardada', async () => {
    await show(ana, HOME).expect(200);
    await show(beto, HOME).expect(200);
    expect(ids(await nearbyOf(beto))).toContain(ana.id);

    await ana.agent.delete('/nearby/me').expect(204);
    expect(ids(await nearbyOf(beto))).not.toContain(ana.id);
    const [row] = await ctx.db.select().from(nearbyPresence).where(eq(nearbyPresence.userId, ana.id));
    expect(row).toMatchObject({ cellRow: null, cellCol: null, visibleUntil: null });
    expect(((await ana.agent.get('/nearby/me').expect(200)).body as NearbyStatusDto).visible).toBe(false);
  });

  it('la visibilidad se apaga sola a la hora', async () => {
    await show(ana, HOME).expect(200);
    await show(beto, HOME).expect(200);
    const service = ctx.app.get(NearbyService);
    expect(await service.hideExpired(new Date(Date.now() + (NEARBY_VISIBLE_MINUTES + 1) * 60_000))).toBeGreaterThanOrEqual(2);
    await beto.agent.get('/nearby').expect(409);
    const [row] = await ctx.db.select().from(nearbyPresence).where(eq(nearbyPresence.userId, ana.id));
    expect(row?.cellRow).toBeNull();
  });

  it('anti-rastreo: cambiar de zona tiene un tiempo mínimo y un máximo por día', async () => {
    await show(ana, HOME).expect(200);
    await show(ana, HOME).expect(200); // renovar en la misma zona no cuenta
    expect((await show(ana, cellAt(0.03)).expect(429)).body.code).toBe('NEARBY_TOO_FAST');

    const service = ctx.app.get(NearbyService);
    const start = Date.now() + 10 * 60_000;
    let left = NEARBY_MAX_CHANGES_PER_DAY;
    for (let index = 1; left > 0; index++) {
      left = (await service.show(beto.id, cellAt(index * 0.01), new Date(start + index * NEARBY_MIN_CHANGE_SECONDS * 1000))).changesLeft;
    }
    await expect(service.show(beto.id, cellAt(0.5), new Date(start + 100 * NEARBY_MIN_CHANGE_SECONDS * 1000))).rejects.toMatchObject({ status: 429 });
    // Al otro día vuelve a habilitarse.
    const tomorrow = new Date(start + 25 * 60 * 60 * 1000);
    expect((await service.show(beto.id, cellAt(0.5), tomorrow)).changesLeft).toBe(NEARBY_MAX_CHANGES_PER_DAY - 1);
  });

  it('pausar la cuenta la oculta y darla de baja borra todo', async () => {
    const gabi = await signUp(ctx, 'gabi.cerca', 'Ga#Cercanos2026-ok');
    const hugo = await signUp(ctx, 'hugo.cerca', 'Hu#Cercanos2026-ok');
    await show(gabi, HOME).expect(200);
    await show(hugo, HOME).expect(200);
    await show(ana, HOME).expect(200);

    await gabi.agent.post('/users/me/pause').send({ password: gabi.password }).expect(204);
    await hugo.agent.post('/users/me/delete').send({ password: hugo.password }).expect(204);
    expect(ids(await nearbyOf(ana))).toEqual([]);
    expect(await ctx.db.select().from(nearbyPresence).where(eq(nearbyPresence.userId, hugo.id))).toEqual([]);
    const [paused] = await ctx.db.select().from(nearbyPresence).where(eq(nearbyPresence.userId, gabi.id));
    expect(paused?.cellRow).toBeNull();
  });
});
