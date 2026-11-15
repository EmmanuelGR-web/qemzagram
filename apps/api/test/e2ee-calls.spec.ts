import { openCallKey, openEnvelope, sealCallKey, sealMessage, type CallJoinDto, type ConversationDto } from '@qemzagram/shared';
import { recipientsFor, setupE2ee, type E2eeDevice } from './support/e2ee-client';
import { createTestApp, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Llamadas cifradas de extremo a extremo', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let chat: string;
  let anaDevice: E2eeDevice;
  let betoDevice: E2eeDevice;

  const befriend = async (a: TestUser, b: TestUser) => {
    await a.agent.post('/contacts').send({ tag: b.tag }).expect(201);
    await b.agent.post('/contacts').send({ tag: a.tag }).expect(201);
  };
  const start = (user: TestUser, body: Record<string, unknown>) => user.agent.post(`/chats/${chat}/calls`).send(body);
  const sealFor = async (device: E2eeDevice, id = crypto.randomUUID()) => {
    const sealed = await sealCallKey({ conversationId: chat, objectId: id, senderId: device.user.id }, device, await recipientsFor(device, chat));
    return { id, envelope: sealed.envelope, key: sealed.key };
  };
  const hangUp = async (join: CallJoinDto) => {
    await ana.agent.post(`/calls/${join.call.id}/leave`).expect(200);
    await beto.agent.post(`/calls/${join.call.id}/leave`);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.e2ecall', 'An#Llamada2026-ok');
    beto = await signUp(ctx, 'beto.e2ecall', 'Be#Llamada2026-ok');
    carla = await signUp(ctx, 'carla.e2ecall', 'Ca#Llamada2026-ok');
    await befriend(ana, beto);
    chat = ((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200)).body as ConversationDto).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('sin claves de todos, la llamada es la de siempre (cifrada en tránsito) y no se puede pedir E2EE', async () => {
    anaDevice = await setupE2ee(ana);
    const plain = (await start(ana, { kind: 'audio' }).expect(201)).body as CallJoinDto;
    expect(plain.call.e2ee).toBeNull();
    await hangUp(plain);
    const sealed = await sealFor(anaDevice);
    expect((await start(ana, { kind: 'audio', e2ee: { id: sealed.id, envelope: sealed.envelope } }).expect(409)).body.code).toBe('E2EE_UNAVAILABLE');
  });

  it('con todos con claves, la llamada exige su clave envuelta y cada miembro la abre con la suya', async () => {
    betoDevice = await setupE2ee(beto);
    expect((await start(ana, { kind: 'video' }).expect(409)).body.code).toBe('E2EE_REQUIRED');

    const sealed = await sealFor(anaDevice);
    const started = (await start(ana, { kind: 'video', e2ee: { id: sealed.id, envelope: sealed.envelope } }).expect(201)).body as CallJoinDto;
    expect(started.call.id).toBe(sealed.id);
    expect(started.call.e2ee).toEqual(sealed.envelope);
    // El servidor de medios recibe un token normal: nunca la clave.
    expect(JSON.stringify(ctx.callMedia)).not.toContain(Buffer.from(sealed.key).toString('base64'));

    const joined = (await beto.agent.post(`/calls/${sealed.id}/join`).expect(200)).body as CallJoinDto;
    if (!joined.call.e2ee) throw new Error('sin clave');
    const key = await openCallKey(joined.call.e2ee, { conversationId: chat, objectId: sealed.id, senderId: ana.id }, { userId: beto.id, keyId: betoDevice.keyId, privateKey: betoDevice.privateKey }, anaDevice.publicJwk);
    expect(Buffer.from(key).equals(Buffer.from(sealed.key))).toBe(true);

    // La clave está atada a ESTA llamada: no sirve como mensaje ni para otra llamada.
    await expect(openEnvelope(joined.call.e2ee, { purpose: 'msg', conversationId: chat, objectId: sealed.id, senderId: ana.id }, { userId: beto.id, keyId: betoDevice.keyId, privateKey: betoDevice.privateKey }, anaDevice.publicJwk)).rejects.toMatchObject({ code: 'TAMPERED' });
    await expect(openCallKey(joined.call.e2ee, { conversationId: chat, objectId: crypto.randomUUID(), senderId: ana.id }, { userId: beto.id, keyId: betoDevice.keyId, privateKey: betoDevice.privateKey }, anaDevice.publicJwk)).rejects.toMatchObject({ code: 'TAMPERED' });
    await hangUp(started);

    // El mismo id no se puede reutilizar.
    expect((await start(ana, { kind: 'video', e2ee: { id: sealed.id, envelope: sealed.envelope } }).expect(409)).body.code).toBe('CALL_ID_TAKEN');
  });

  it('rechaza sobres con destinatarios incorrectos y entradas inválidas', async () => {
    const id = crypto.randomUUID();
    const onlyMe = (await recipientsFor(anaDevice, chat)).filter((recipient) => recipient.userId === ana.id);
    const partial = await sealCallKey({ conversationId: chat, objectId: id, senderId: ana.id }, anaDevice, onlyMe);
    expect((await start(ana, { kind: 'audio', e2ee: { id, envelope: partial.envelope } }).expect(409)).body.code).toBe('E2EE_KEYS_CHANGED');
    await start(ana, { kind: 'audio', e2ee: { id: 'no-uuid', envelope: partial.envelope } }).expect(400);
    await start(ana, { kind: 'audio', e2ee: { id, envelope: partial.envelope, key: 'secreta' } }).expect(400);
    // Quien no es miembro no ve la llamada ni puede iniciarla.
    const sealed = await sealMessage({ t: 'text', body: 'x' }, { conversationId: chat, objectId: id, senderId: ana.id }, anaDevice, await recipientsFor(anaDevice, chat));
    await carla.agent.post(`/chats/${chat}/calls`).send({ kind: 'audio', e2ee: { id, envelope: sealed.envelope } }).expect(404);
  });
});
