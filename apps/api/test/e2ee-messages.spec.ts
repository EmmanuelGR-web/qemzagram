import { openMessage, sealMessage, type ConversationDto, type E2eeContent, type MessageDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { CryptoService } from '../src/common/crypto.service';
import { messages, reportEvidence, reports } from '../src/database/schema';
import { evidenceAad } from '../src/media/media.service';
import { recipientsFor, setupE2ee, type E2eeDevice } from './support/e2ee-client';
import { createTestApp, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Mensajes cifrados de extremo a extremo y denuncias con franqueo', () => {
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
  const seal = async (device: E2eeDevice, conversationId: string, content: E2eeContent, id: string = crypto.randomUUID()) => {
    const sealed = await sealMessage(content, { conversationId, objectId: id, senderId: device.user.id }, device, await recipientsFor(device, conversationId));
    return { id, envelope: sealed.envelope, commitment: sealed.commitment };
  };
  const send = (device: E2eeDevice, conversationId: string, body: Record<string, unknown>) =>
    device.user.agent.post(`/chats/${conversationId}/e2ee/messages`).send(body);
  const open = (device: E2eeDevice, message: MessageDto, senderDevice: E2eeDevice) => {
    if (!message.e2ee) throw new Error('No es un mensaje cifrado');
    return openMessage(
      message.e2ee.envelope,
      message.e2ee.commitment,
      { conversationId: message.conversationId, objectId: message.id, senderId: message.senderId },
      { userId: device.user.id, keyId: device.keyId, privateKey: device.privateKey },
      senderDevice.publicJwk,
    );
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.e2emsg', 'An#Mensaje2026-ok');
    beto = await signUp(ctx, 'beto.e2emsg', 'Be#Mensaje2026-ok');
    carla = await signUp(ctx, 'carla.e2emsg', 'Ca#Mensaje2026-ok');
    await befriend(ana, beto);
    await befriend(ana, carla);
    chat = ((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200)).body as ConversationDto).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('mientras alguien no activó el cifrado, el chat sigue con el cifrado del servidor', async () => {
    await ana.agent.post(`/chats/${chat}/messages`).send({ body: 'hola sin e2ee' }).expect(201);
    anaDevice = await setupE2ee(ana);
    // Beto todavía no tiene claves: no se puede cifrar para él.
    const sealed = await seal(anaDevice, chat, { t: 'text', body: 'secreto' });
    expect((await send(anaDevice, chat, sealed).expect(409)).body.code).toBe('E2EE_UNAVAILABLE');
    await ana.agent.post(`/chats/${chat}/messages`).send({ body: 'todavía se puede' }).expect(201);
  });

  it('con todos con claves, el servidor guarda solo el sobre y ya no acepta mensajes legibles', async () => {
    betoDevice = await setupE2ee(beto);
    expect((await ana.agent.post(`/chats/${chat}/messages`).send({ body: 'en claro' }).expect(409)).body.code).toBe('E2EE_REQUIRED');
    expect((await ana.agent.post(`/chats/${chat}/stickers`).send({ code: 'hola' }).expect(409)).body.code).toBe('E2EE_REQUIRED');

    const secret = 'La reunión es a las 21 en la plaza 🤫';
    const sealed = await seal(anaDevice, chat, { t: 'text', body: secret });
    const sent = (await send(anaDevice, chat, sealed).expect(201)).body as MessageDto;
    expect(sent).toMatchObject({ id: sealed.id, body: '', sticker: null, senderId: ana.id });
    expect(sent.e2ee?.commitment).toBe(sealed.commitment);

    // Beto lo lee con SU clave; el servidor no puede.
    const listed = (await beto.agent.get(`/chats/${chat}/messages`).expect(200)).body as MessageDto[];
    const received = listed.find((message) => message.id === sealed.id);
    if (!received) throw new Error('No llegó');
    expect((await open(betoDevice, received, anaDevice)).content).toEqual({ t: 'text', body: secret });
    // Ana también lo puede releer (se cifra para quien envía).
    expect((await open(anaDevice, received, anaDevice)).content).toEqual({ t: 'text', body: secret });

    const [row] = await ctx.db.select().from(messages).where(eq(messages.id, sealed.id));
    expect(JSON.stringify(row)).not.toContain('reunión');
    expect(ctx.app.get(CryptoService).decryptText(row?.body ?? '', chat)).toBe('');

    // El sticker del pack también viaja cifrado.
    const sticker = await seal(anaDevice, chat, { t: 'sticker', code: 'hola' });
    await send(anaDevice, chat, sticker).expect(201);
    const [stickerRow] = await ctx.db.select().from(messages).where(eq(messages.id, sticker.id));
    expect(stickerRow?.stickerCode).toBeNull();
  });

  it('el sobre tiene que traer EXACTAMENTE las claves actuales de los miembros', async () => {
    const recipients = await recipientsFor(anaDevice, chat);
    const sealWith = async (list: typeof recipients, sender = anaDevice) => {
      const id = crypto.randomUUID();
      const sealed = await sealMessage({ t: 'text', body: 'x' }, { conversationId: chat, objectId: id, senderId: ana.id }, sender, list);
      return { id, envelope: sealed.envelope, commitment: sealed.commitment };
    };
    // Falta Beto.
    const missing = await sealWith(recipients.filter((recipient) => recipient.userId !== beto.id));
    expect((await send(anaDevice, chat, missing).expect(409)).body.code).toBe('E2EE_KEYS_CHANGED');
    // Sobra alguien que no es miembro (Carla no está en el chat).
    const carlaDevice = await setupE2ee(carla);
    const extra = await sealWith([...recipients, { userId: carla.id, keyId: carlaDevice.keyId, publicJwk: carlaDevice.publicJwk }]);
    expect((await send(anaDevice, chat, extra).expect(409)).body.code).toBe('E2EE_KEYS_CHANGED');
    // Clave de quien envía que no es la suya.
    const wrongSender = await sealWith(recipients, { ...anaDevice, keyId: betoDevice.keyId });
    expect((await send(anaDevice, chat, wrongSender).expect(409)).body.code).toBe('E2EE_KEYS_CHANGED');
  });

  it('valida la entrada, exige sesión y membresía, y no acepta ids repetidos', async () => {
    const sealed = await seal(anaDevice, chat, { t: 'text', body: 'una vez' });
    await send(anaDevice, chat, sealed).expect(201);
    expect((await send(anaDevice, chat, sealed).expect(409)).body.code).toBe('MESSAGE_ID_TAKEN');

    const fresh = await seal(anaDevice, chat, { t: 'text', body: 'otra' });
    await request(ctx.app.getHttpServer()).post(`/chats/${chat}/e2ee/messages`).set('Origin', ORIGIN).send(fresh).expect(401);
    await carla.agent.post(`/chats/${chat}/e2ee/messages`).send(fresh).expect(404);
    await send(anaDevice, chat, { ...fresh, body: 'texto en claro' }).expect(400);
    await send(anaDevice, chat, { ...fresh, senderId: beto.id }).expect(400);
    await send(anaDevice, chat, { ...fresh, commitment: 'corto' }).expect(400);
    await send(anaDevice, chat, { ...fresh, id: 'no-uuid' }).expect(400);
    await send(anaDevice, chat, { ...fresh, envelope: { ...fresh.envelope, keys: {} } }).expect(400);
  });

  it('quien recibe detecta mensajes alterados o movidos y franqueos que no coinciden', async () => {
    const sealed = await seal(anaDevice, chat, { t: 'text', body: 'original' });
    const sent = (await send(anaDevice, chat, sealed).expect(201)).body as MessageDto;
    if (!sent.e2ee) throw new Error('sin sobre');
    // El servidor cambia el compromiso: el mensaje no se muestra (no se podría denunciar).
    await expect(open(betoDevice, { ...sent, e2ee: { ...sent.e2ee, commitment: sealed.commitment.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')) } }, anaDevice)).rejects.toMatchObject({ code: 'TAMPERED' });
    // El servidor lo "mueve" a otro id o dice que lo mandó otra persona.
    await expect(open(betoDevice, { ...sent, id: crypto.randomUUID() }, anaDevice)).rejects.toMatchObject({ code: 'TAMPERED' });
    await expect(open(betoDevice, { ...sent, senderId: beto.id }, anaDevice)).rejects.toMatchObject({ code: 'TAMPERED' });
  });

  it('grupos: es de extremo a extremo solo cuando TODOS los miembros activaron el cifrado', async () => {
    const dani = await signUp(ctx, 'dani.e2emsg', 'Da#Mensaje2026-ok');
    await befriend(ana, dani);
    const group = ((await ana.agent.post('/chats/groups').send({ title: 'Equipo', memberTags: [beto.tag, carla.tag, dani.tag] }).expect(201)).body as ConversationDto).id;
    await ana.agent.post(`/chats/${group}/messages`).send({ body: 'Dani todavía no tiene claves' }).expect(201);
    const daniDevice = await setupE2ee(dani);
    await ana.agent.post(`/chats/${group}/messages`).send({ body: 'ya no' }).expect(409);
    const sealed = await seal(anaDevice, group, { t: 'text', body: 'para los cuatro' });
    const sent = (await send(anaDevice, group, sealed).expect(201)).body as MessageDto;
    expect(Object.keys(sent.e2ee?.envelope.keys ?? {})).toHaveLength(4);
    expect((await open(daniDevice, sent, anaDevice)).content).toEqual({ t: 'text', body: 'para los cuatro' });
  });

  describe('denuncias', () => {
    beforeEach(async () => {
      await ctx.db.delete(reports);
    });

    it('con el franqueo correcto, la evidencia se acepta como VERIFICADA y soporte ve solo ese mensaje', async () => {
      const sealed = await seal(anaDevice, chat, { t: 'text', body: 'mensaje ofensivo' });
      const sent = (await send(anaDevice, chat, sealed).expect(201)).body as MessageDto;
      const opened = await open(betoDevice, sent, anaDevice);

      await beto.agent.post('/reports').send({ userId: ana.id, reason: 'harassment', evidence: [{ type: 'message', id: sent.id, reveal: opened.reveal }] }).expect(201);
      const [evidence] = await ctx.db.select().from(reportEvidence);
      expect(evidence).toMatchObject({ verified: true, kind: 'text', sourceId: sent.id });
      expect(ctx.app.get(CryptoService).decryptText(evidence?.bodyEncrypted ?? '', evidenceAad(evidence?.id ?? ''))).toBe('mensaje ofensivo');
    });

    it('rechaza evidencia inventada, editada, sin revelar o revelada para un mensaje que no es cifrado', async () => {
      const sealed = await seal(anaDevice, chat, { t: 'text', body: 'lo que dije' });
      const sent = (await send(anaDevice, chat, sealed).expect(201)).body as MessageDto;
      const { reveal } = await open(betoDevice, sent, anaDevice);
      const reportWith = (evidence: unknown[]) => beto.agent.post('/reports').send({ userId: ana.id, reason: 'harassment', evidence });

      await reportWith([{ type: 'message', id: sent.id }]).expect(400);
      // Beto "edita" lo que dijo Ana.
      await reportWith([{ type: 'message', id: sent.id, reveal: { ...reveal, content: JSON.stringify({ t: 'text', body: 'algo peor' }) } }]).expect(400);
      // Una clave de franqueo cualquiera.
      await reportWith([{ type: 'message', id: sent.id, reveal: { ...reveal, fk: 'A'.repeat(43) } }]).expect(400);
      // Reutilizar la revelación de un mensaje en OTRO mensaje.
      const other = (await send(anaDevice, chat, await seal(anaDevice, chat, { t: 'text', body: 'otro' })).expect(201)).body as MessageDto;
      await reportWith([{ type: 'message', id: other.id, reveal }]).expect(400);
      // Los estados no llevan revelación.
      await reportWith([{ type: 'status', id: sent.id, reveal }]).expect(400);
      // Un mensaje viejo (cifrado por el servidor) no lleva revelación.
      const legacy = ((await beto.agent.get(`/chats/${chat}/messages`).expect(200)).body as MessageDto[]).find((message) => !message.e2ee && message.senderId === ana.id);
      if (!legacy) throw new Error('falta un mensaje sin e2ee');
      await reportWith([{ type: 'message', id: legacy.id, reveal }]).expect(400);
      expect(await ctx.db.select().from(reports)).toHaveLength(0);
      // Carla no es miembro del chat: no puede usar mensajes de ese chat aunque tenga la revelación.
      await carla.agent.post('/reports').send({ userId: ana.id, reason: 'harassment', evidence: [{ type: 'message', id: sent.id, reveal }] }).expect(400);
    });
  });
});
