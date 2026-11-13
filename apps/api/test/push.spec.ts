import { CALL_RING_SECONDS, type CallJoinDto, type PushConfigDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { CallsService } from '../src/calls/calls.service';
import { pushSubscriptions } from '../src/database/schema';
import { isAllowedPushEndpoint } from '../src/notifications/push.service';
import { createTestApp, ORIGIN, signUp, waitUntil, type TestContext, type TestUser } from './support/test-app';

/** Claves con el formato real de una suscripción (p256dh: 87 caracteres, auth: 22). */
const KEYS = { p256dh: `B${'x'.repeat(86)}`, auth: 'a'.repeat(22) };
const endpoint = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;

describe('Notificaciones push (Web Push)', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let directId: string;

  const subscribe = (user: TestUser, url: string, keys: Record<string, string> = KEYS) => user.agent.post('/push/subscriptions').send({ endpoint: url, keys });
  const sentTo = (url: string) => ctx.push.sent.filter((item) => item.endpoint === url);

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.push', 'An#Push2026-segura');
    beto = await signUp(ctx, 'beto.push', 'Be#Push2026-segura');
    await ana.agent.post('/contacts').send({ tag: 'beto.push' }).expect(201);
    directId = ((await ana.agent.post('/chats/direct').send({ tag: 'beto.push' }).expect(200)).body as { id: string }).id;
  });
  afterEach(async () => {
    await ctx.app.get(CallsService).expire(new Date(Date.now() + 10 * 60 * 60 * 1000));
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('entrega la clave pública y exige sesión para suscribirse', async () => {
    expect(((await ana.agent.get('/push/config').expect(200)).body as PushConfigDto).publicKey).toHaveLength(87);
    const server = ctx.app.getHttpServer();
    await request(server).get('/push/config').set('Origin', ORIGIN).expect(401);
    await request(server).post('/push/subscriptions').set('Origin', ORIGIN).send({ endpoint: endpoint('x'), keys: KEYS }).expect(401);
  });

  it('guarda la suscripción CIFRADA (ni la dirección ni las claves quedan legibles)', async () => {
    await subscribe(beto, endpoint('beto-celular')).expect(204);
    const rows = await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, beto.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dataEncrypted).not.toContain('fcm.googleapis.com');
    expect(rows[0]?.dataEncrypted).not.toContain(KEYS.auth);
  });

  it('solo acepta servicios de push oficiales (evita que la API haga pedidos a cualquier lado)', async () => {
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://localhost/push',
      'https://169.254.169.254/latest/meta-data',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://fcm.googleapis.com.atacante.com/x',
      'https://atacante.com/fcm.googleapis.com',
      'https://usuario:clave@fcm.googleapis.com/x',
    ]) {
      await subscribe(ana, bad).expect(400);
    }
    await subscribe(ana, endpoint('ok'), { p256dh: 'corta', auth: KEYS.auth }).expect(400);
    await ana.agent.post('/push/subscriptions').send({ endpoint: endpoint('ok'), keys: KEYS, userId: beto.id }).expect(400);

    expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true);
    expect(isAllowedPushEndpoint('https://push.apple.com.evil.net/abc')).toBe(false);
  });

  it('una llamada entrante avisa por push sin contenido sensible; al no atenderla queda como perdida', async () => {
    await subscribe(beto, endpoint('beto-celular')).expect(204);
    const before = sentTo(endpoint('beto-celular')).length;
    const call = ((await ana.agent.post(`/chats/${directId}/calls`).send({ kind: 'video' }).expect(201)).body as CallJoinDto).call;

    await waitUntil(() => sentTo(endpoint('beto-celular')).length > before);
    const ring = sentTo(endpoint('beto-celular')).at(-1);
    expect(ring?.payload).toEqual({ type: 'call', callId: call.id, conversationId: directId, kind: 'video', title: 'ana.push', group: false });
    expect(ring?.options).toMatchObject({ ttl: CALL_RING_SECONDS, urgency: 'high', topic: call.id.replace(/-/g, '') });
    expect(sentTo(endpoint('ana-no-suscripta'))).toEqual([]); // quien llama no recibe aviso

    await ctx.app.get(CallsService).expire(new Date(Date.now() + (CALL_RING_SECONDS + 1) * 1000));
    await waitUntil(() => sentTo(endpoint('beto-celular')).at(-1)?.payload.type === 'call-closed');
    expect(sentTo(endpoint('beto-celular')).at(-1)?.payload).toMatchObject({ type: 'call-closed', callId: call.id, missed: true });
  });

  it('al atender, los otros dispositivos de esa persona dejan de sonar (no es "perdida")', async () => {
    await subscribe(beto, endpoint('beto-tablet')).expect(204);
    const call = ((await ana.agent.post(`/chats/${directId}/calls`).send({ kind: 'audio' }).expect(201)).body as CallJoinDto).call;
    await beto.agent.post(`/calls/${call.id}/join`).expect(200);
    await waitUntil(() => sentTo(endpoint('beto-tablet')).some((item) => item.payload.type === 'call-closed' && item.payload.callId === call.id));
    expect(sentTo(endpoint('beto-tablet')).find((item) => item.payload.type === 'call-closed' && item.payload.callId === call.id)?.payload.missed).toBe(false);
    await beto.agent.post(`/calls/${call.id}/leave`).expect(200);
  });

  it('borra las suscripciones que el navegador canceló', async () => {
    await subscribe(beto, endpoint('beto-viejo')).expect(204);
    ctx.push.gone.add(endpoint('beto-viejo'));
    const countBeto = async () => (await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, beto.id))).length;
    const before = await countBeto();
    const call = ((await ana.agent.post(`/chats/${directId}/calls`).send({ kind: 'audio' }).expect(201)).body as CallJoinDto).call;
    // Se espera a que el envío en segundo plano termine y borre la suscripción cancelada.
    for (let attempt = 0; attempt < 100 && (await countBeto()) === before; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await countBeto()).toBe(before - 1);
    await ana.agent.post(`/calls/${call.id}/leave`).expect(200);
  });

  it('un dispositivo es de una sola cuenta, se puede desuscribir y hay un máximo por persona', async () => {
    // El mismo navegador con otra cuenta: la suscripción pasa a la cuenta nueva.
    await subscribe(ana, endpoint('compartido')).expect(204);
    await subscribe(beto, endpoint('compartido')).expect(204);
    const owners = await ctx.db.select().from(pushSubscriptions);
    expect(owners.filter((row) => row.userId === ana.id)).toHaveLength(0);

    // Desuscribir solo afecta lo propio.
    await ana.agent.post('/push/subscriptions/remove').send({ endpoint: endpoint('compartido') }).expect(204);
    expect((await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, beto.id))).length).toBeGreaterThan(0);

    for (let index = 0; index < 12; index++) await subscribe(ana, endpoint(`ana-${index}`)).expect(204);
    expect(await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, ana.id))).toHaveLength(10);
  });

  it('dar de baja la cuenta borra sus suscripciones', async () => {
    const eva = await signUp(ctx, 'eva.push', 'Ev#Push2026-segura');
    await subscribe(eva, endpoint('eva')).expect(204);
    await eva.agent.post('/users/me/delete').send({ password: eva.password }).expect(204);
    expect(await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, eva.id))).toEqual([]);
  });
});
