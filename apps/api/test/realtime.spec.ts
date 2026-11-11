import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { createTestApp, ORIGIN, signUp, type TestContext } from './support/test-app';

function waitFor<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout esperando ${event}`)), 8000);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Tiempo real (Socket.IO)', () => {
  let ctx: TestContext;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
    url = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    sockets.forEach((socket) => socket.close());
    await ctx.close();
  });

  it('entrega mensajes al instante a los miembros y rechaza conexiones sin ticket válido', async () => {
    const luis = await signUp(ctx, 'luis.rt', 'Lu#Tiempo2026-clave');
    const sofia = await signUp(ctx, 'sofia.rt', 'So#Tiempo2026-clave');
    await luis.agent.post('/contacts').send({ tag: 'sofia.rt' }).expect(201);

    // sin ticket => desconectado
    const anonymous = io(url, { auth: {}, transports: ['websocket'], reconnection: false });
    sockets.push(anonymous);
    await new Promise<void>((resolve) => anonymous.on('disconnect', () => resolve()));
    const forged = io(url, { auth: { ticket: 'falso' }, transports: ['websocket'], reconnection: false });
    sockets.push(forged);
    await new Promise<void>((resolve) => forged.on('disconnect', () => resolve()));

    const ticket = (await sofia.agent.post('/auth/ws-ticket').expect(200)).body.ticket as string;
    const socket = io(url, { auth: { ticket }, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: ORIGIN } });
    sockets.push(socket);
    await waitFor(socket, 'connect');

    const created = waitFor<{ id: string }>(socket, 'chat:created');
    const chat = await luis.agent.post('/chats/direct').send({ tag: 'sofia.rt' }).expect(200);
    expect((await created).id).toBe(chat.body.id);

    const received = waitFor<{ body: string; senderId: string }>(socket, 'chat:message');
    await luis.agent.post(`/chats/${chat.body.id}/messages`).send({ body: 'Hola Sofi en tiempo real' }).expect(201);
    expect(await received).toMatchObject({ body: 'Hola Sofi en tiempo real', senderId: luis.id });
  });
});
