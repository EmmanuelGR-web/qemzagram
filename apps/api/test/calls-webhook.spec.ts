import type { CallDto, CallJoinDto } from '@qemzagram/shared';
import { AccessToken } from 'livekit-server-sdk';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { InvalidMediaEventError } from '../src/calls/call-media.port';
import { LiveKitCallMedia } from '../src/calls/livekit.media';
import { createTestApp, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Llamadas: avisos del servidor de medios (webhook)', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let dani: TestUser;
  let directId: string;
  let groupId: string;

  /** Simula un aviso de LiveKit (sin cookies ni Origin, como llega de verdad). */
  const webhook = (event: unknown, authorization = 'Bearer firma-valida', contentType = 'application/webhook+json') =>
    request(ctx.app.getHttpServer()).post('/calls/livekit-webhook').set('Content-Type', contentType).set('Authorization', authorization).send(JSON.stringify(event));
  const getCall = async (user: TestUser, id: string) => (await user.agent.get(`/calls/${id}`).expect(200)).body as CallDto;

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.hook', 'An#Webhook2026');
    beto = await signUp(ctx, 'beto.hook', 'Be#Webhook2026');
    dani = await signUp(ctx, 'dani.hook', 'Da#Webhook2026');
    await ana.agent.post('/contacts').send({ tag: 'beto.hook' }).expect(201);
    await ana.agent.post('/contacts').send({ tag: 'dani.hook' }).expect(201);
    directId = ((await ana.agent.post('/chats/direct').send({ tag: 'beto.hook' }).expect(200)).body as { id: string }).id;
    groupId = ((await ana.agent.post('/chats/groups').send({ title: 'Grupo', memberTags: ['beto.hook', 'dani.hook'] }).expect(201)).body as { id: string }).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('rechaza avisos sin firma válida o con otro formato', async () => {
    const event = { type: 'room_finished', room: randomUUID() };
    await webhook(event, 'Bearer firma-falsa').expect(403);
    await webhook(event, '').expect(403);
    await webhook(event, 'Bearer firma-valida', 'application/json').expect(403);
  });

  it('si alguien se cae de una llamada 1 a 1, la llamada termina', async () => {
    const call = ((await ana.agent.post(`/chats/${directId}/calls`).send({ kind: 'audio' }).expect(201)).body as CallJoinDto).call;
    await beto.agent.post(`/calls/${call.id}/join`).expect(200);

    // Una identidad que no está en la llamada se ignora.
    await webhook({ type: 'participant_left', room: call.id, identity: dani.id }).expect(200);
    expect((await getCall(ana, call.id)).status).toBe('active');

    await webhook({ type: 'participant_left', room: call.id, identity: beto.id }).expect(200);
    expect(await getCall(ana, call.id)).toMatchObject({ status: 'ended', endReason: 'completed' });
  });

  it('en un grupo sigue mientras quede alguien; "sala cerrada" la termina', async () => {
    const call = ((await ana.agent.post(`/chats/${groupId}/calls`).send({ kind: 'video' }).expect(201)).body as CallJoinDto).call;
    await beto.agent.post(`/calls/${call.id}/join`).expect(200);
    await webhook({ type: 'participant_left', room: call.id, identity: ana.id }).expect(200);
    const after = await getCall(beto, call.id);
    expect(after.status).toBe('active');
    expect(after.participants.find((participant) => participant.user.id === ana.id)?.state).toBe('left');

    await webhook({ type: 'room_finished', room: call.id }).expect(200);
    expect(await getCall(beto, call.id)).toMatchObject({ status: 'ended', endReason: 'completed' });
  });

  it('ignora salas que no son llamadas nuestras', async () => {
    await webhook({ type: 'room_finished', room: 'otra-sala' }).expect(200);
    await webhook({ type: 'participant_left', room: randomUUID(), identity: 'alguien' }).expect(200);
  });
});

describe('Webhook de LiveKit: verificación real de la firma', () => {
  const key = 'clave-de-prueba';
  const secret = 'secreto-de-prueba-de-al-menos-32-caracteres';
  const media = new LiveKitCallMedia('wss://medios.prueba', 'https://medios.prueba', key, secret);

  /** Firma un cuerpo como lo hace LiveKit: JWT con el hash SHA-256 del cuerpo. */
  const sign = async (body: string, signingSecret = secret) => {
    const token = new AccessToken(key, signingSecret);
    token.sha256 = createHash('sha256').update(body).digest('base64');
    return token.toJwt(); // LiveKit manda el JWT tal cual en la cabecera Authorization
  };

  it('acepta un aviso firmado y rechaza uno alterado o firmado con otro secreto', async () => {
    const room = randomUUID();
    const body = JSON.stringify({ event: 'participant_left', room: { name: room }, participant: { identity: 'usuario-1' }, id: 'ev1', createdAt: '1' });
    expect(await media.parseEvent(body, await sign(body))).toEqual({ type: 'participant_left', room, identity: 'usuario-1' });

    const tampered = body.replace('usuario-1', 'usuario-2');
    await expect(media.parseEvent(tampered, await sign(body))).rejects.toBeInstanceOf(InvalidMediaEventError);
    await expect(media.parseEvent(body, await sign(body, 'otro-secreto-que-no-es-el-nuestro-aaaa'))).rejects.toBeInstanceOf(InvalidMediaEventError);
    await expect(media.parseEvent(body, undefined)).rejects.toBeInstanceOf(InvalidMediaEventError);

    const other = JSON.stringify({ event: 'track_published', room: { name: room }, id: 'ev2', createdAt: '1' });
    expect(await media.parseEvent(other, await sign(other))).toBeNull();
  });
});
