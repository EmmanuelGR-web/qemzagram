import { toNearbyCell, type ContactDto, type ConversationDto, type NearbyGreetResultDto, type NearbyGreetingsDto, type NearbyPersonDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { contacts, nearbyGreetings, nearbyPresence, userBlocks } from '../src/database/schema';
import { GreetingsRepository } from '../src/database/repositories/greetings.repository';
import { RealtimePublisher } from '../src/realtime/realtime.port';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

const HOME = toNearbyCell(-26.8303, -65.2038);
const FAR = toNearbyCell(-26.8303 + 0.36, -65.2038); // ~40 km

describe('Saludos entre personas cercanas', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let dani: TestUser;
  let eva: TestUser;
  let lejos: TestUser;
  let oculto: TestUser;
  let events: { users: string[]; event: string; payload: unknown }[];

  const show = (user: TestUser, cell = HOME) => user.agent.put('/nearby/me').send({ cell, consent: true }).expect(200);
  const greet = (user: TestUser, target: TestUser) => user.agent.post('/nearby/greetings').send({ userId: target.id });
  const greetingsOf = async (user: TestUser) => (await user.agent.get('/nearby/greetings').expect(200)).body as NearbyGreetingsDto;
  const seenBy = async (user: TestUser, target: TestUser) =>
    ((await user.agent.get('/nearby').expect(200)).body as NearbyPersonDto[]).find((person) => person.user.id === target.id);

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.saludo', 'An#Saludos2026-ok');
    beto = await signUp(ctx, 'beto.saludo', 'Be#Saludos2026-ok');
    carla = await signUp(ctx, 'carla.saludo', 'Ca#Saludos2026-ok');
    dani = await signUp(ctx, 'dani.saludo', 'Da#Saludos2026-ok');
    eva = await signUp(ctx, 'eva.saludo', 'Ev#Saludos2026-ok');
    lejos = await signUp(ctx, 'lejos.saludo', 'Le#Saludos2026-ok');
    oculto = await signUp(ctx, 'oculto.saludo', 'Oc#Saludos2026-ok');
    // Se registran los avisos en tiempo real (esta suite no necesita sockets reales).
    jest.spyOn(ctx.app.get(RealtimePublisher), 'toUsers').mockImplementation((users, event, ...payload) => {
      events.push({ users, event, payload: payload[0] });
    });
  });
  beforeEach(async () => {
    events = [];
    await ctx.db.delete(nearbyGreetings);
    await ctx.db.delete(userBlocks);
    await ctx.db.delete(contacts);
    await ctx.db.delete(nearbyPresence);
    for (const user of [ana, beto, carla, dani, eva]) await show(user);
    await show(lejos, FAR);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('exige sesión y valida la entrada', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).get('/nearby/greetings').set('Origin', ORIGIN).expect(401);
    await request(server).post('/nearby/greetings').set('Origin', ORIGIN).send({ userId: beto.id }).expect(401);
    await ana.agent.post('/nearby/greetings').send({}).expect(400);
    await ana.agent.post('/nearby/greetings').send({ userId: 'x' }).expect(400);
    await ana.agent.post('/nearby/greetings').send({ userId: beto.id, fromId: carla.id }).expect(400);
    await ana.agent.post('/nearby/greetings/no-es-uuid/accept').expect(400);
    await greet(ana, ana).expect(400);
  });

  it('solo se puede saludar a quien aparece AHORA en tu lista de cercanos', async () => {
    expect((await greet(ana, lejos).expect(404)).body.code).toBe('NEARBY_USER_NOT_FOUND'); // a 40 km
    await greet(ana, oculto).expect(404); // no está visible
    await ana.agent.post('/nearby/greetings').send({ userId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await oculto.agent.post('/nearby/greetings').send({ userId: ana.id }).expect(409); // quien saluda debe estar visible
    await eva.agent.post('/blocks').send({ userId: ana.id }).expect(204);
    await greet(ana, eva).expect(404); // con bloqueo, "no está cerca"
    await greet(eva, ana).expect(404);
  });

  it('saludar → aceptar: quedan en la agenda del otro y recién ahí se ve el tag', async () => {
    expect(((await greet(ana, beto).expect(200)).body as NearbyGreetResultDto).state).toBe('sent');
    expect(events.find((item) => item.event === 'nearby:greeting')?.users).toEqual([beto.id]);
    expect((await greet(ana, beto).expect(409)).body.code).toBe('GREETING_ALREADY_SENT');

    const received = (await greetingsOf(beto)).received;
    expect(received).toHaveLength(1);
    expect(Object.keys(received[0]?.user ?? {}).sort()).toEqual(['avatarUrl', 'displayName', 'id']); // sin tag
    expect((await greetingsOf(ana)).sent.map((item) => item.user.id)).toEqual([beto.id]);
    expect(await seenBy(ana, beto)).toMatchObject({ greeting: 'sent', tag: null, greetingId: null });
    expect(await seenBy(beto, ana)).toMatchObject({ greeting: 'received', tag: null, greetingId: received[0]?.id });

    // Nadie más puede aceptar un saludo ajeno.
    await carla.agent.post(`/nearby/greetings/${received[0]?.id}/accept`).expect(404);
    await ana.agent.post(`/nearby/greetings/${received[0]?.id}/accept`).expect(404); // ni quien lo mandó

    const contact = (await beto.agent.post(`/nearby/greetings/${received[0]?.id}/accept`).expect(200)).body as ContactDto;
    expect(contact.user).toMatchObject({ id: ana.id, tag: ana.tag });
    expect(events.find((item) => item.event === 'nearby:connected')?.users).toEqual([ana.id]);
    expect(await seenBy(ana, beto)).toMatchObject({ greeting: 'connected', tag: beto.tag });
    await beto.agent.post(`/nearby/greetings/${received[0]?.id}/accept`).expect(404); // ya no está pendiente
    expect((await greet(ana, beto).expect(409)).body.code).toBe('ALREADY_CONNECTED');

    // Ya pueden chatear (están en la agenda del otro).
    await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200);
    const chat = (await beto.agent.post('/chats/direct').send({ tag: ana.tag }).expect(200)).body as ConversationDto;
    await beto.agent.post(`/chats/${chat.id}/messages`).send({ body: '¡Hola vecina!' }).expect(201);
  });

  it('si se saludan mutuamente quedan conectados solos', async () => {
    await greet(carla, dani).expect(200);
    const result = (await greet(dani, carla).expect(200)).body as NearbyGreetResultDto;
    expect(result.state).toBe('connected');
    expect(result.contact?.user.tag).toBe(carla.tag);
    expect((await greetingsOf(carla)).sent).toEqual([]);
    expect((await carla.agent.get('/contacts').expect(200)).body.map((item: ContactDto) => item.user.id)).toContain(dani.id);
  });

  it('el rechazo nunca se le informa a quien saludó', async () => {
    await greet(carla, dani).expect(200);
    const [greeting] = (await greetingsOf(dani)).received;
    await dani.agent.post(`/nearby/greetings/${greeting?.id}/decline`).expect(204);
    await dani.agent.post(`/nearby/greetings/${greeting?.id}/decline`).expect(404);
    await dani.agent.post(`/nearby/greetings/${greeting?.id}/accept`).expect(404);

    expect((await greetingsOf(dani)).received).toEqual([]);
    // Para carla todo se ve igual que con un saludo pendiente.
    expect((await greetingsOf(carla)).sent.map((item) => item.user.id)).toEqual([dani.id]);
    expect(await seenBy(carla, dani)).toMatchObject({ greeting: 'sent' });
    expect((await greet(carla, dani).expect(409)).body.code).toBe('GREETING_ALREADY_SENT');
    expect(events.filter((item) => item.users.includes(carla.id))).toEqual([]);
    expect(await seenBy(dani, carla)).toMatchObject({ greeting: 'none' });
  });

  it('los saludos vencen a las 24 h y después se puede volver a saludar', async () => {
    await greet(ana, carla).expect(200);
    const [greeting] = (await greetingsOf(carla)).received;
    await ctx.db
      .update(nearbyGreetings)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(nearbyGreetings.id, greeting?.id ?? ''));
    expect((await greetingsOf(carla)).received).toEqual([]);
    expect((await greetingsOf(ana)).sent).toEqual([]);
    await carla.agent.post(`/nearby/greetings/${greeting?.id}/accept`).expect(404);
    await greet(ana, carla).expect(200);
  });

  it('un bloqueo oculta el saludo y ya no se puede aceptar', async () => {
    await greet(ana, eva).expect(200);
    const [greeting] = (await greetingsOf(eva)).received;
    await ana.agent.post('/blocks').send({ userId: eva.id }).expect(204);
    expect((await greetingsOf(eva)).received).toEqual([]);
    expect((await greetingsOf(ana)).sent).toEqual([]);
    await eva.agent.post(`/nearby/greetings/${greeting?.id}/accept`).expect(404);
    expect((await eva.agent.get('/contacts').expect(200)).body).toEqual([]);
  });

  it('máximo de saludos por día', async () => {
    const spy = jest.spyOn(ctx.app.get(GreetingsRepository), 'countSentSince').mockResolvedValueOnce(20);
    expect((await greet(ana, carla).expect(429)).body.code).toBe('GREETINGS_DAILY_LIMIT');
    spy.mockRestore();
  });
});
