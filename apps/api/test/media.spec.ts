import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import type { MessageDto } from '@qemzagram/shared';
import { attachments, auditLog, messages } from '../src/database/schema';
import { MediaUrlService } from '../src/media/media-url.service';
import { binary, storedFiles } from './support/files';
import { createTestApp, EICAR, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Adjuntos: imágenes, URLs firmadas y seguridad', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let intruso: TestUser;
  let chatId: string;

  /** JPEG con metadatos EXIF (incluye un "Copyright" para comprobar que se borran). */
  const photoWithExif = () =>
    sharp({ create: { width: 1200, height: 900, channels: 3, background: '#d91e36' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'DATO-PRIVADO', Artist: 'Ana' } })
      .toBuffer();

  const sendImage = (user: TestUser, data: Buffer, fields: Record<string, string> = { kind: 'image' }, conversation = chatId) => {
    let request = user.agent.post(`/chats/${conversation}/attachments`);
    for (const [key, value] of Object.entries(fields)) request = request.field(key, value);
    return request.attach('file', data, { filename: 'foto.jpg', contentType: 'image/jpeg' });
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.media', 'An#Media2026-clave');
    beto = await signUp(ctx, 'beto.media', 'Be#Media2026-clave');
    intruso = await signUp(ctx, 'intruso.media', 'In#Media2026-clave');
    await ana.agent.post('/contacts').send({ tag: 'beto.media' }).expect(201);
    const chat = await ana.agent.post('/chats/direct').send({ tag: 'beto.media' }).expect(200);
    chatId = (chat.body as { id: string }).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('envía una imagen: la re-codifica a WebP, borra los metadatos y la guarda cifrada', async () => {
    const original = await photoWithExif();
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const sent = await sendImage(ana, original, { kind: 'image', caption: 'Mirá esto' }).expect(201);
    const message = sent.body as MessageDto;
    expect(message.body).toBe('Mirá esto');
    expect(message.attachment).toMatchObject({ kind: 'image', mimeType: 'image/webp', width: 1200, height: 900, name: null });
    expect(message.attachment?.url).toMatch(/^\/media\/a\/[0-9a-f-]{36}\?exp=\d+&sig=[A-Za-z0-9_-]{43}$/);

    // el otro miembro la puede ver; ya no tiene EXIF
    const served = await beto.agent.get(message.attachment?.url ?? '').buffer(true).parse(binary).expect(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.headers['cache-control']).toMatch(/^private/);
    const metadata = await sharp(served.body as Buffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect((served.body as Buffer).includes('DATO-PRIVADO')).toBe(false);

    // en disco está cifrado: ni es un WebP ni contiene los bytes de la imagen
    const [row] = await ctx.db.select().from(attachments).where(eq(attachments.id, message.attachment?.id ?? ''));
    const file = storedFiles().find((path) => path.endsWith(row?.storageKey ?? '-'));
    expect(file).toBeDefined();
    const raw = readFileSync(file ?? '');
    expect(raw.subarray(0, 4).toString('latin1')).not.toBe('RIFF');
    expect(raw.includes((served.body as Buffer).subarray(0, 64))).toBe(false);

    // el epígrafe también se guarda cifrado en la base
    const [stored] = await ctx.db.select().from(messages).where(eq(messages.id, message.id));
    expect(stored?.body).not.toContain('Mirá');

    // aparece en el historial y como último mensaje del chat
    const history = await beto.agent.get(`/chats/${chatId}/messages`).expect(200);
    expect((history.body as MessageDto[]).at(-1)?.attachment?.id).toBe(message.attachment?.id);
    const list = await beto.agent.get('/chats').expect(200);
    expect((list.body as { lastMessage: MessageDto }[])[0]?.lastMessage.attachment?.kind).toBe('image');
  });

  it('solo los miembros actuales pueden descargar, siempre con sesión y firma válida', async () => {
    const sent = await sendImage(ana, await photoWithExif()).expect(201);
    expect((sent.body as MessageDto).body).toBe(''); // sin comentario: texto vacío (no "[Mensaje no disponible]")
    const history = await beto.agent.get(`/chats/${chatId}/messages`).expect(200);
    expect((history.body as MessageDto[]).at(-1)?.body).toBe('');
    const url = (sent.body as MessageDto).attachment?.url ?? '';
    const id = (sent.body as MessageDto).attachment?.id ?? '';

    await intruso.agent.get(url).expect(404); // con la URL firmada, pero no es miembro
    await request(ctx.app.getHttpServer()).get(url).expect(401); // sin sesión

    const [, query] = url.split('?');
    const params = new URLSearchParams(query);
    const tampered = `/media/a/${id}?exp=${Number(params.get('exp')) + 900}&sig=${params.get('sig')}`;
    await beto.agent.get(tampered).expect(404); // vencimiento adulterado
    await beto.agent.get(`/media/a/${id}?exp=${params.get('exp')}&sig=${'A'.repeat(43)}`).expect(404); // firma inventada
    await beto.agent.get(`/media/a/${id}`).expect(400); // sin firma

    const signer = ctx.app.get(MediaUrlService);
    const expired = signer.sign('a', id, Date.now() - 3 * 60 * 60 * 1000);
    await beto.agent.get(expired.url).expect(404); // URL vencida

    // otra conversación: la firma de un adjunto no sirve para otro id
    const otherId = '00000000-0000-4000-8000-000000000000';
    await beto.agent.get(`/media/a/${otherId}?${query}`).expect(404);
  });

  it('rechaza archivos disfrazados, campos extra, tipos inválidos y archivos enormes', async () => {
    await sendImage(ana, Buffer.from('<script>alert(1)</script>')).expect(400);
    await sendImage(ana, Buffer.from('MZ\x90\x00 ejecutable')).expect(400);
    await sendImage(ana, Buffer.from('%PDF-1.7 no soy una foto')).expect(400); // es real, pero no es imagen
    await sendImage(ana, await photoWithExif(), { kind: 'ejecutable' }).expect(400);
    await sendImage(ana, await photoWithExif(), { kind: 'image', role: 'admin' }).expect(400);
    await ana.agent.post(`/chats/${chatId}/attachments`).field('kind', 'image').expect(400); // sin archivo

    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(11 * 1024 * 1024, 1)]);
    const tooBig = await sendImage(ana, huge);
    expect(tooBig.status).toBe(413);

    await request(ctx.app.getHttpServer()).post(`/chats/${chatId}/attachments`).set('Origin', 'http://localhost:3000').field('kind', 'image').expect(401);
    await sendImage(intruso, await photoWithExif()).expect(404); // no es miembro del chat
  });

  it('el antivirus bloquea archivos infectados (y lo audita) y falla cerrado si no responde', async () => {
    const infected = Buffer.concat([await photoWithExif(), Buffer.from(EICAR)]);
    const before = storedFiles().length;
    const blocked = await sendImage(ana, infected).expect(400);
    expect(blocked.body.code).toBe('MALWARE_DETECTED');
    expect(storedFiles().length).toBe(before);
    const events = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'upload.malware_blocked'));
    expect(events.length).toBe(1);

    ctx.antivirus.unavailable = true;
    const down = await sendImage(ana, await photoWithExif()).expect(503);
    expect(down.body.code).toBe('ANTIVIRUS_UNAVAILABLE');
    ctx.antivirus.unavailable = false;
  });

  it('sirve rangos de bytes (para adelantar audio y video)', async () => {
    const sent = await sendImage(ana, await photoWithExif()).expect(201);
    const url = (sent.body as MessageDto).attachment?.url ?? '';
    const partial = await beto.agent.get(url).set('Range', 'bytes=0-9').buffer(true).parse(binary).expect(206);
    expect((partial.body as Buffer).length).toBe(10);
    expect(partial.headers['content-range']).toMatch(/^bytes 0-9\/\d+$/);
    await beto.agent.get(url).set('Range', 'bytes=999999999-').expect(416);
  });

  it('al eliminarse un grupo se borran también sus archivos', async () => {
    await ana.agent.post('/contacts').send({ tag: 'intruso.media' }).expect(201);
    const group = await ana.agent.post('/chats/groups').send({ title: 'Fotos', memberTags: ['beto.media'] }).expect(201);
    const groupId = (group.body as { id: string }).id;
    await sendImage(ana, await photoWithExif(), { kind: 'image' }, groupId).expect(201);
    const before = storedFiles().length;
    await beto.agent.delete(`/chats/${groupId}/members/me`).expect(204);
    await ana.agent.delete(`/chats/${groupId}/members/me`).expect(204);
    expect(storedFiles().length).toBe(before - 1);
  });
});
