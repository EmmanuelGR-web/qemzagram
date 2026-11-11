import type { MessageDto } from '@qemzagram/shared';
import { binary } from './support/files';
import { createTestApp, signUp, type TestContext, type TestUser } from './support/test-app';

/** Cabeceras reales de WebM y MP4 (alcanzan para la detección por contenido; el conversor es falso). */
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('grabacion-del-navegador')]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from('video-del-celular')]);

describe('Adjuntos: notas de voz', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let chatId: string;

  const send = (kind: string, data: Buffer, filename: string) =>
    ana.agent.post(`/chats/${chatId}/attachments`).field('kind', kind).attach('file', data, { filename, contentType: 'application/octet-stream' });

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.voz', 'An#Voz2026-clave');
    beto = await signUp(ctx, 'beto.voz', 'Be#Voz2026-clave');
    await ana.agent.post('/contacts').send({ tag: 'beto.voz' }).expect(201);
    chatId = ((await ana.agent.post('/chats/direct').send({ tag: 'beto.voz' }).expect(200)).body as { id: string }).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('convierte la nota de voz y la entrega lista para reproducir', async () => {
    const sent = await send('audio', WEBM, 'nota-de-voz.webm').expect(201);
    const attachment = (sent.body as MessageDto).attachment;
    expect(attachment).toMatchObject({ kind: 'audio', mimeType: 'audio/mp4', durationMs: 4200 });
    expect(ctx.transcoder.calls.at(-1)).toBe('voice');

    const played = await beto.agent.get(attachment?.url ?? '').buffer(true).parse(binary).expect(200);
    expect(played.headers['content-type']).toBe('audio/mp4');
    expect(played.headers['content-disposition']).toMatch(/^inline/);
    expect((played.body as Buffer).toString()).toBe('audio-convertido'); // se guarda lo convertido, no el original
  });

  it('rechaza lo que no es audio, lo demasiado largo, y funciona "fallando cerrado" sin ffmpeg', async () => {
    expect((await send('audio', Buffer.from('%PDF-1.7 hola'), 'audio.pdf').expect(400)).body.code).toBe('INVALID_MEDIA');
    expect((await send('audio', Buffer.concat([WEBM, Buffer.from('MUY-LARGO')]), 'largo.webm').expect(400)).body.code).toBe('MEDIA_TOO_LONG');

    ctx.transcoder.available = false;
    expect((await send('audio', WEBM, 'nota.webm').expect(503)).body.code).toBe('MEDIA_UNAVAILABLE');
    ctx.transcoder.available = true;
  });

  it('exige ser miembro del chat', async () => {
    const intruso = await signUp(ctx, 'intruso.voz', 'In#Voz2026-clave');
    await intruso.agent.post(`/chats/${chatId}/attachments`).field('kind', 'audio').attach('file', WEBM, 'x.webm').expect(404);
    expect(MP4.length).toBeGreaterThan(0);
  });
});
