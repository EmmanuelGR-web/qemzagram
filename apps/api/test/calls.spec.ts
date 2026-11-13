import { CALL_RING_SECONDS, type CallDto, type CallJoinDto } from '@qemzagram/shared';
import { TokenVerifier } from 'livekit-server-sdk';
import request from 'supertest';
import { CallsService } from '../src/calls/calls.service';
import { LiveKitCallMedia } from '../src/calls/livekit.media';
import { RealtimePublisher } from '../src/realtime/realtime.port';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Llamadas y videollamadas', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let dani: TestUser;
  let directId: string;
  let groupId: string;
  let toUsers: jest.SpyInstance;

  const start = (user: TestUser, conversationId: string, kind = 'video') => user.agent.post(`/chats/${conversationId}/calls`).send({ kind });
  const startOk = async (user: TestUser, conversationId: string, kind = 'video') => (await start(user, conversationId, kind).expect(201)).body as CallJoinDto;
  const getCall = async (user: TestUser, id: string) => (await user.agent.get(`/calls/${id}`).expect(200)).body as CallDto;
  const stateOf = (call: CallDto, user: TestUser) => call.participants.find((participant) => participant.user.id === user.id)?.state;
  const lastEvent = (event: string) => toUsers.mock.calls.filter((args: unknown[]) => args[1] === event).at(-1) as [string[], string, CallDto] | undefined;

  beforeAll(async () => {
    ctx = await createTestApp();
    toUsers = jest.spyOn(ctx.app.get(RealtimePublisher), 'toUsers');
    ana = await signUp(ctx, 'ana.call', 'An#Llamadas2026');
    beto = await signUp(ctx, 'beto.call', 'Be#Llamadas2026');
    carla = await signUp(ctx, 'carla.call', 'Ca#Llamadas2026');
    dani = await signUp(ctx, 'dani.call', 'Da#Llamadas2026');
    await ana.agent.post('/contacts').send({ tag: 'beto.call' }).expect(201);
    await ana.agent.post('/contacts').send({ tag: 'dani.call' }).expect(201);
    directId = ((await ana.agent.post('/chats/direct').send({ tag: 'beto.call' }).expect(200)).body as { id: string }).id;
    groupId = ((await ana.agent.post('/chats/groups').send({ title: 'Equipo', memberTags: ['beto.call', 'dani.call'] }).expect(201)).body as { id: string }).id;
  });
  afterEach(async () => {
    // Ninguna llamada queda abierta entre un test y otro (se "adelanta el reloj" 10 horas).
    await ctx.app.get(CallsService).expire(new Date(Date.now() + 10 * 60 * 60 * 1000));
  });
  afterAll(async () => {
    toUsers.mockRestore();
    await ctx.close();
  });

  it('exige sesión', async () => {
    const server = ctx.app.getHttpServer();
    await request(server).post(`/chats/${directId}/calls`).set('Origin', ORIGIN).send({ kind: 'audio' }).expect(401);
    await request(server).get('/calls/active').set('Origin', ORIGIN).expect(401);
  });

  it('llama 1 a 1: suena en el otro, entrega un token SOLO para esa sala y la otra persona atiende', async () => {
    const started = await startOk(ana, directId, 'video');
    expect(started.url).toBe('wss://medios.prueba');
    expect(started.call).toMatchObject({ status: 'ringing', kind: 'video', conversationType: 'direct', startedBy: ana.id });
    expect(stateOf(started.call, ana)).toBe('joined');
    expect(stateOf(started.call, beto)).toBe('invited');
    expect(ctx.callMedia.tokens.at(-1)).toEqual({ room: started.call.id, identity: ana.id, name: 'ana.call', kind: 'video' });

    const incoming = lastEvent('call:incoming');
    expect(incoming?.[0]).toEqual([beto.id]);
    expect(incoming?.[2].id).toBe(started.call.id);

    const joined = (await beto.agent.post(`/calls/${started.call.id}/join`).expect(200)).body as CallJoinDto;
    expect(joined.call.status).toBe('active');
    expect(joined.call.answeredAt).not.toBeNull();
    expect(joined.token).toContain(beto.id);
    expect(lastEvent('call:updated')?.[0].sort()).toEqual([ana.id, beto.id].sort());

    const ended = (await ana.agent.post(`/calls/${started.call.id}/leave`).expect(200)).body as CallDto;
    expect(ended).toMatchObject({ status: 'ended', endReason: 'completed' });
    expect(ctx.callMedia.closedRooms).toContain(started.call.id);
    await beto.agent.post(`/calls/${started.call.id}/join`).expect(409);
  });

  it('una sola llamada en curso por chat', async () => {
    const started = await startOk(ana, directId, 'audio');
    const again = await start(beto, directId, 'video').expect(409);
    expect(again.body as { code: string; callId: string }).toMatchObject({ code: 'CALL_IN_PROGRESS', callId: started.call.id });
    await ana.agent.post(`/calls/${started.call.id}/leave`).expect(200);
  });

  it('rechazar, cancelar y "perdida" terminan la llamada con el motivo correcto', async () => {
    const declined = await startOk(ana, directId);
    expect(((await beto.agent.post(`/calls/${declined.call.id}/decline`).expect(200)).body as CallDto).endReason).toBe('declined');

    const cancelled = await startOk(ana, directId);
    expect(((await ana.agent.post(`/calls/${cancelled.call.id}/leave`).expect(200)).body as CallDto).endReason).toBe('cancelled');

    const missed = await startOk(ana, directId);
    const service = ctx.app.get(CallsService);
    expect(await service.expire(new Date(Date.now() + (CALL_RING_SECONDS - 5) * 1000))).toBe(0); // todavía suena
    expect(await service.expire(new Date(Date.now() + (CALL_RING_SECONDS + 1) * 1000))).toBe(1);
    expect(await getCall(beto, missed.call.id)).toMatchObject({ status: 'ended', endReason: 'missed' });
  });

  it('las llamadas de voz no pueden publicar cámara', async () => {
    const started = await startOk(ana, directId, 'audio');
    expect(ctx.callMedia.tokens.at(-1)?.kind).toBe('audio');
    await beto.agent.post(`/calls/${started.call.id}/join`).expect(200);
    expect(ctx.callMedia.tokens.at(-1)).toMatchObject({ identity: beto.id, kind: 'audio' });
    await beto.agent.post(`/calls/${started.call.id}/leave`).expect(200);
  });

  it('nadie fuera de la conversación puede ver, iniciar, entrar ni cortar una llamada', async () => {
    const started = await startOk(ana, directId);
    const id = started.call.id;
    await start(carla, directId).expect(404);
    await carla.agent.get(`/calls/${id}`).expect(404);
    await carla.agent.post(`/calls/${id}/join`).expect(404);
    await carla.agent.post(`/calls/${id}/decline`).expect(404);
    await carla.agent.post(`/calls/${id}/leave`).expect(404);
    expect((await carla.agent.get('/calls/active').expect(200)).body).toEqual([]);
    expect(((await beto.agent.get('/calls/active').expect(200)).body as CallDto[]).map((call) => call.id)).toEqual([id]);
    expect(ctx.callMedia.tokens.some((token) => token.identity === carla.id)).toBe(false);
    await ana.agent.post(`/calls/${id}/leave`).expect(200);
  });

  it('valida la entrada', async () => {
    await start(ana, directId, 'pantalla').expect(400);
    await ana.agent.post(`/chats/${directId}/calls`).send({ kind: 'audio', room: 'otra-sala' }).expect(400);
    await ana.agent.post(`/chats/${directId}/calls`).send({}).expect(400);
    await ana.agent.post('/calls/no-es-uuid/join').expect(400);
  });

  it('grupo: sigue mientras quede alguien; termina cuando todos se van', async () => {
    const started = await startOk(ana, groupId, 'video');
    expect(lastEvent('call:incoming')?.[0].sort()).toEqual([beto.id, dani.id].sort());
    await beto.agent.post(`/calls/${started.call.id}/join`).expect(200);
    const afterDecline = (await dani.agent.post(`/calls/${started.call.id}/decline`).expect(200)).body as CallDto;
    expect(afterDecline.status).toBe('active');
    expect(stateOf(afterDecline, dani)).toBe('declined');

    expect(((await ana.agent.post(`/calls/${started.call.id}/leave`).expect(200)).body as CallDto).status).toBe('active');
    // Dani puede sumarse más tarde aunque antes la haya rechazado.
    await dani.agent.post(`/calls/${started.call.id}/join`).expect(200);
    await dani.agent.post(`/calls/${started.call.id}/leave`).expect(200);
    const ended = (await beto.agent.post(`/calls/${started.call.id}/leave`).expect(200)).body as CallDto;
    expect(ended).toMatchObject({ status: 'ended', endReason: 'completed' });
  });

  it('grupo: si todos rechazan, termina', async () => {
    const started = await startOk(ana, groupId, 'audio');
    await beto.agent.post(`/calls/${started.call.id}/decline`).expect(200);
    expect(((await dani.agent.post(`/calls/${started.call.id}/decline`).expect(200)).body as CallDto)).toMatchObject({
      status: 'ended',
      endReason: 'declined',
    });
  });

  it('quien deja el grupo ya no puede entrar a su llamada', async () => {
    const eva = await signUp(ctx, 'eva.call', 'Ev#Llamadas2026');
    await ana.agent.post('/contacts').send({ tag: 'eva.call' }).expect(201);
    const group = ((await ana.agent.post('/chats/groups').send({ title: 'Temporal', memberTags: ['eva.call', 'beto.call'] }).expect(201)).body as { id: string }).id;
    const started = await startOk(ana, group, 'audio');
    await eva.agent.delete(`/chats/${group}/members/me`).expect(204);
    await eva.agent.post(`/calls/${started.call.id}/join`).expect(404);
    await ana.agent.post(`/calls/${started.call.id}/leave`).expect(200);
  });

  it('sin servidor de medios configurado responde 503', async () => {
    ctx.callMedia.available = false;
    try {
      const response = await start(ana, directId).expect(503);
      expect((response.body as { code: string }).code).toBe('CALLS_UNAVAILABLE');
    } finally {
      ctx.callMedia.available = true;
    }
  });
});

describe('Token de LiveKit (permisos mínimos)', () => {
  const key = 'clave-de-prueba';
  const secret = 'secreto-de-prueba-de-al-menos-32-caracteres';
  const media = new LiveKitCallMedia('wss://medios.prueba', 'https://medios.prueba', key, secret);

  it('solo permite entrar a ESA sala, publicar micrófono (y cámara en video) y vence rápido', async () => {
    const audio = await new TokenVerifier(key, secret).verify(await media.createJoinToken({ room: 'sala-1', identity: 'usuario-1', name: 'Ana', kind: 'audio' }));
    expect(audio.sub).toBe('usuario-1');
    expect(audio.video).toMatchObject({ roomJoin: true, room: 'sala-1', canPublish: true, canSubscribe: true, canPublishData: false });
    expect(audio.video?.roomAdmin).toBeFalsy();
    expect(audio.video?.roomCreate).toBeFalsy();
    expect(audio.video?.canPublishSources).toEqual(['microphone']);
    const lifetime = (audio.exp ?? 0) - Math.floor(Date.now() / 1000);
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(120);

    const video = await new TokenVerifier(key, secret).verify(await media.createJoinToken({ room: 'sala-1', identity: 'usuario-1', name: 'Ana', kind: 'video' }));
    expect(video.video?.canPublishSources).toEqual(['microphone', 'camera']);
    await expect(new TokenVerifier(key, 'otro-secreto-que-no-corresponde-aaaaaaa').verify(await media.createJoinToken({ room: 'x', identity: 'y', name: 'z', kind: 'audio' }))).rejects.toThrow();
  });
});
