import type { ConversationDto, PushPayload } from '@qemzagram/shared';
import request from 'supertest';
import { ChatsService } from '../src/chats/chats.service';
import { PushService } from '../src/notifications/push.service';
import { createTestApp, ORIGIN, signUp, waitUntil, type TestContext, type TestUser } from './support/test-app';

describe('Silenciar chats y avisos de mensajes', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let directId: string;
  let groupId: string;
  let pushes: { users: string[]; payload: PushPayload }[];

  const befriend = async (a: TestUser, b: TestUser) => {
    await a.agent.post('/contacts').send({ tag: b.tag }).expect(201);
    await b.agent.post('/contacts').send({ tag: a.tag }).expect(201);
  };
  const mute = (user: TestUser, id: string, duration: unknown) => user.agent.put(`/chats/${id}/mute`).send({ duration });
  const lastPush = async () => {
    await waitUntil(() => pushes.length > 0);
    return pushes[pushes.length - 1];
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.mute', 'An#Silencio2026-ok');
    beto = await signUp(ctx, 'beto.mute', 'Be#Silencio2026-ok');
    carla = await signUp(ctx, 'carla.mute', 'Ca#Silencio2026-ok');
    await befriend(ana, beto);
    await befriend(ana, carla);
    directId = ((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200)).body as ConversationDto).id;
    groupId = ((await ana.agent.post('/chats/groups').send({ title: 'Asado', memberTags: [beto.tag, carla.tag] }).expect(201)).body as ConversationDto).id;
    jest.spyOn(ctx.app.get(PushService), 'notify').mockImplementation(async (users, payload) => {
      pushes.push({ users, payload });
    });
  });
  beforeEach(async () => {
    pushes = [];
    for (const user of [ana, beto, carla]) {
      await mute(user, groupId, 'off').expect(200);
    }
    await mute(ana, directId, 'off').expect(200);
    await mute(beto, directId, 'off').expect(200);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('exige sesión, valida la duración y no deja silenciar chats ajenos', async () => {
    await request(ctx.app.getHttpServer()).put(`/chats/${directId}/mute`).set('Origin', ORIGIN).send({ duration: '8h' }).expect(401);
    await mute(ana, directId, '3d').expect(400);
    await mute(ana, directId, undefined).expect(400);
    await ana.agent.put(`/chats/${directId}/mute`).send({ duration: '8h', userId: beto.id }).expect(400);
    await mute(ana, 'no-es-uuid', '8h').expect(400);
    // carla no es miembro del chat de ana y beto: "no encontrado", sin revelar que existe.
    expect((await mute(carla, directId, '8h').expect(404)).body.code).toBe('CHAT_NOT_FOUND');
  });

  it('el aviso de un mensaje nunca lleva el contenido ni le llega a quien lo envió', async () => {
    await ana.agent.patch('/users/me').send({ displayName: 'Ana Silencio' }).expect(200);
    await ana.agent.post(`/chats/${directId}/messages`).send({ body: 'Secreto: la clave es 1234' }).expect(201);
    const push = await lastPush();
    expect(push?.users).toEqual([beto.id]);
    expect(push?.payload).toEqual({ type: 'message', conversationId: directId, title: 'Ana Silencio', group: false });
    expect(JSON.stringify(push?.payload)).not.toContain('1234');

    pushes = [];
    await beto.agent.post(`/chats/${groupId}/stickers`).send({ code: 'hola' }).expect(201);
    const groupPush = await lastPush();
    expect(groupPush?.users.sort()).toEqual([ana.id, carla.id].sort());
    expect(groupPush?.payload).toMatchObject({ type: 'message', title: 'Asado', group: true });
  });

  it('quien silencia deja de recibir avisos; solo lo ve esa persona', async () => {
    const muted = (await mute(beto, directId, '8h').expect(200)).body as ConversationDto;
    expect(new Date(muted.mutedUntil ?? 0).getTime() - Date.now()).toBeGreaterThan(7.9 * 60 * 60 * 1000);
    expect(((await ana.agent.get(`/chats/${directId}`).expect(200)).body as ConversationDto).mutedUntil).toBeNull();

    await ana.agent.post(`/chats/${directId}/messages`).send({ body: 'hola' }).expect(201);
    await waitUntil(() => pushes.length > 0);
    expect(pushes.flatMap((push) => push.users)).toEqual([]);

    await mute(carla, groupId, 'always').expect(200);
    pushes = [];
    await ana.agent.post(`/chats/${groupId}/messages`).send({ body: 'hola grupo' }).expect(201);
    expect((await lastPush())?.users).toEqual([beto.id]);
    const list = (await carla.agent.get('/chats').expect(200)).body as ConversationDto[];
    expect(list.find((item) => item.id === groupId)?.mutedUntil?.startsWith('9999')).toBe(true);

    // Volver a activar.
    expect(((await mute(beto, directId, 'off').expect(200)).body as ConversationDto).mutedUntil).toBeNull();
  });

  it('el silencio vence solo', async () => {
    const service = ctx.app.get(ChatsService);
    await service.mute(beto.id, directId, '1w', new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    expect(((await beto.agent.get(`/chats/${directId}`).expect(200)).body as ConversationDto).mutedUntil).toBeNull();
    await ana.agent.post(`/chats/${directId}/messages`).send({ body: 'hola otra vez' }).expect(201);
    expect((await lastPush())?.users).toEqual([beto.id]);
  });
});
