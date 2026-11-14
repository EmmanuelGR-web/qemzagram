import type { BlockedUserDto, CallJoinDto, ContactDto, ConversationDto, StatusOverviewDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { userBlocks } from '../src/database/schema';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Bloqueo de usuarios', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let directId: string;

  const befriend = async (a: TestUser, b: TestUser) => {
    await a.agent.post('/contacts').send({ tag: b.tag }).expect(201);
    await b.agent.post('/contacts').send({ tag: a.tag }).expect(201);
  };
  const block = (user: TestUser, target: TestUser) => user.agent.post('/blocks').send({ userId: target.id });
  const unblock = (user: TestUser, target: TestUser) => user.agent.delete(`/blocks/${target.id}`);
  const contactsOf = async (user: TestUser) => (await user.agent.get('/contacts').expect(200)).body as ContactDto[];
  const chat = async (user: TestUser, id: string) => (await user.agent.get(`/chats/${id}`).expect(200)).body as ConversationDto;

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.bloq', 'An#Bloqueo2026-ok');
    beto = await signUp(ctx, 'beto.bloq', 'Be#Bloqueo2026-ok');
    carla = await signUp(ctx, 'carla.bloq', 'Ca#Bloqueo2026-ok');
    await befriend(ana, beto);
    await befriend(ana, carla);
    await befriend(beto, carla);
    directId = ((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200)).body as ConversationDto).id;
    await beto.agent.patch('/users/me').send({ bio: 'Bio de Beto' }).expect(200);
    await ana.agent.patch('/users/me').send({ bio: 'Bio de Ana' }).expect(200);
  });
  afterEach(async () => {
    // Cada prueba arranca sin bloqueos.
    await ctx.db.delete(userBlocks);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('exige sesión y valida la entrada', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).get('/blocks').set('Origin', ORIGIN).expect(401);
    await request(server).post('/blocks').set('Origin', ORIGIN).send({ userId: beto.id }).expect(401);

    await ana.agent.post('/blocks').send({}).expect(400);
    await ana.agent.post('/blocks').send({ userId: 'no-es-uuid' }).expect(400);
    await ana.agent.post('/blocks').send({ userId: beto.id, blockerId: carla.id }).expect(400); // no se acepta "en nombre de" otra persona
    await block(ana, ana).expect(400);
    await ana.agent.post('/blocks').send({ userId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await ana.agent.delete('/blocks/no-es-uuid').expect(400);
    await unblock(ana, beto).expect(404); // no estaba bloqueado
  });

  it('para quien fue bloqueado, quien lo bloqueó "no existe" (perfil, agenda, chat nuevo)', async () => {
    await block(ana, beto).expect(204);
    await block(ana, beto).expect(204); // repetir no falla

    await beto.agent.get(`/users/by-tag/${ana.tag}`).expect(404);
    expect((await contactsOf(beto)).map((contact) => contact.user.id)).not.toContain(ana.id);
    expect((await beto.agent.post('/contacts').send({ tag: ana.tag }).expect(404)).body.code).toBe('USER_NOT_FOUND');
    expect((await beto.agent.post('/chats/direct').send({ tag: ana.tag }).expect(404)).body.code).toBe('USER_NOT_FOUND');

    // Quien bloqueó recibe un aviso claro y lo ve marcado en su agenda.
    expect((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(409)).body.code).toBe('USER_BLOCKED');
    expect((await contactsOf(ana)).find((contact) => contact.user.id === beto.id)?.blocked).toBe(true);
    expect((await contactsOf(ana)).find((contact) => contact.user.id === carla.id)?.blocked).toBe(false);
    const list = (await ana.agent.get('/blocks').expect(200)).body as BlockedUserDto[];
    expect(list.map((item) => item.user.id)).toEqual([beto.id]);
    expect(list[0]?.user.bio).toBe('');
    expect((await beto.agent.get('/blocks').expect(200)).body).toEqual([]); // nadie ve a quién lo bloqueó

    // Al desbloquear vuelve todo (no se borró nada).
    await unblock(ana, beto).expect(204);
    await beto.agent.get(`/users/by-tag/${ana.tag}`).expect(200);
    expect((await contactsOf(beto)).map((contact) => contact.user.id)).toContain(ana.id);
  });

  it('en un chat 1 a 1 existente nadie puede escribir ni llamar, pero el historial queda', async () => {
    await ana.agent.post(`/chats/${directId}/messages`).send({ body: 'antes del bloqueo' }).expect(201);
    await block(ana, beto).expect(204);

    for (const user of [ana, beto]) {
      expect((await user.agent.post(`/chats/${directId}/messages`).send({ body: 'hola' }).expect(403)).body.code).toBe('CHAT_BLOCKED');
      await user.agent.post(`/chats/${directId}/stickers`).send({ code: 'hola' }).expect(403);
      await user.agent.post(`/chats/${directId}/calls`).send({ kind: 'audio' }).expect(403);
      expect((await user.agent.get(`/chats/${directId}/messages`).expect(200)).body).toHaveLength(1);
    }
    expect((await chat(ana, directId)).blockedByMe).toBe(true);
    const asBeto = await chat(beto, directId);
    expect(asBeto.blockedByMe).toBe(false); // no se le informa que lo bloquearon
    expect(asBeto.members.find((member) => member.user.id === ana.id)?.user.bio).toBe(''); // perfil reducido

    await unblock(ana, beto).expect(204);
    await beto.agent.post(`/chats/${directId}/messages`).send({ body: 'de nuevo' }).expect(201);
  });

  it('no se puede atender en un chat 1 a 1 una llamada que sonaba cuando llegó el bloqueo', async () => {
    const call = ((await ana.agent.post(`/chats/${directId}/calls`).send({ kind: 'audio' }).expect(201)).body as CallJoinDto).call;
    await block(beto, ana).expect(204);
    await beto.agent.post(`/calls/${call.id}/join`).expect(403);
    await ana.agent.post(`/calls/${call.id}/leave`).expect(200);
  });

  it('grupos: no se puede crear ni sumar a alguien con bloqueo, y una llamada grupal no le suena', async () => {
    const group = ((await ana.agent.post('/chats/groups').send({ title: 'Equipo', memberTags: [beto.tag, carla.tag] }).expect(201)).body as ConversationDto).id;

    await block(carla, ana).expect(204);
    await ana.agent.post('/chats/groups').send({ title: 'Otro', memberTags: [carla.tag] }).expect(404);
    await carla.agent.post('/chats/groups').send({ title: 'Otro', memberTags: [ana.tag] }).expect(409);

    // Dentro del grupo se puede seguir escribiendo (el grupo es de todos).
    await ana.agent.post(`/chats/${group}/messages`).send({ body: 'hola grupo' }).expect(201);

    const call = ((await ana.agent.post(`/chats/${group}/calls`).send({ kind: 'audio' }).expect(201)).body as CallJoinDto).call;
    const invited = call.participants.map((participant) => participant.user.id);
    expect(invited).toContain(beto.id);
    expect(invited).not.toContain(carla.id);
    await ana.agent.post(`/calls/${call.id}/leave`).expect(200);
  });

  it('los estados se ocultan en las dos direcciones', async () => {
    await ana.agent.post('/statuses/text').send({ body: 'estado de ana', background: 'rojo' }).expect(201);
    await beto.agent.post('/statuses/text').send({ body: 'estado de beto', background: 'rojo' }).expect(201);
    const owners = async (user: TestUser) => ((await user.agent.get('/statuses').expect(200)).body as StatusOverviewDto).feed.map((item) => item.user.id);
    expect(await owners(beto)).toContain(ana.id);

    await block(ana, beto).expect(204);
    expect(await owners(beto)).not.toContain(ana.id);
    expect(await owners(ana)).not.toContain(beto.id);
    expect(await owners(carla)).toEqual(expect.arrayContaining([ana.id, beto.id])); // a terceros no les cambia nada
  });

  it('dar de baja la cuenta borra sus bloqueos', async () => {
    const eva = await signUp(ctx, 'eva.bloq', 'Ev#Bloqueo2026-ok');
    await block(eva, ana).expect(204);
    await block(ana, eva).expect(204);
    await eva.agent.post('/users/me/delete').send({ password: eva.password }).expect(204);
    expect(await ctx.db.select().from(userBlocks).where(eq(userBlocks.blockerId, eva.id))).toEqual([]);
    expect(await ctx.db.select().from(userBlocks).where(eq(userBlocks.blockedId, eva.id))).toEqual([]);
  });
});
