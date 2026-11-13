import { STATUS_VIDEO_MAX_SECONDS, type StatusDto, type StatusOverviewDto } from '@qemzagram/shared';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import request from 'supertest';
import { statuses } from '../src/database/schema';
import { StatusesCleanupService } from '../src/statuses/statuses-cleanup.service';
import { binary, storedFiles } from './support/files';
import { createTestApp, EICAR, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.from('video-del-celular')]);

describe('Estados con foto y video', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;

  const photoWithExif = () =>
    sharp({ create: { width: 1200, height: 900, channels: 3, background: '#d91e36' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'DATO-PRIVADO', Artist: 'Ana' } })
      .toBuffer();

  const upload = (user: TestUser, data: Buffer | null, fields: Record<string, string>) => {
    let call = user.agent.post('/statuses/media');
    for (const [key, value] of Object.entries(fields)) call = call.field(key, value);
    return data ? call.attach('file', data, { filename: 'archivo.jpg', contentType: 'image/jpeg' }) : call;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.estm', 'An#EstMedia2026-ok');
    beto = await signUp(ctx, 'beto.estm', 'Be#EstMedia2026-ok');
    carla = await signUp(ctx, 'carla.estm', 'Ca#EstMedia2026-ok');
    await ana.agent.post('/contacts').send({ tag: 'beto.estm' }).expect(201);
    await beto.agent.post('/contacts').send({ tag: 'ana.estm' }).expect(201);
    await ana.agent.post('/contacts').send({ tag: 'carla.estm' }).expect(201); // Carla no agregó a Ana
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('publica una foto: WebP sin metadatos, guardada cifrada y servida con URL firmada', async () => {
    const previous = new Set(storedFiles());
    const created = (await upload(ana, await photoWithExif(), { kind: 'image', caption: 'Atardecer' }).expect(201)).body as StatusDto;
    expect(created).toMatchObject({ kind: 'image', body: 'Atardecer', background: null });
    expect(created.media).toMatchObject({ mimeType: 'image/webp', width: 1200, height: 900 });
    expect(created.media?.url).toMatch(/^\/media\/e\/[0-9a-f-]{36}\?exp=\d+&sig=/);

    // El archivo en disco está cifrado (no es un WebP legible).
    const added = storedFiles().filter((file) => !previous.has(file));
    expect(added).toHaveLength(1);
    const raw = readFileSync(added[0] ?? '');
    expect(raw.subarray(0, 4).toString()).not.toBe('RIFF');

    const seen = await beto.agent.get(created.media?.url ?? '').buffer(true).parse(binary).expect(200);
    expect(seen.headers['content-type']).toBe('image/webp');
    expect(seen.headers['x-content-type-options']).toBe('nosniff');
    const metadata = await sharp(seen.body as Buffer).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    await ana.agent.get(created.media?.url ?? '').expect(200);
  });

  it('nadie fuera de la audiencia puede bajar el archivo, ni sin sesión, ni con la firma alterada', async () => {
    const created = (await upload(ana, await photoWithExif(), { kind: 'image' }).expect(201)).body as StatusDto;
    const url = created.media?.url ?? '';

    await carla.agent.get(url).expect(404); // tiene la URL firmada pero no está en la audiencia
    await request(ctx.app.getHttpServer()).get(url).set('Origin', ORIGIN).expect(401);
    await beto.agent.get(url.replace(/sig=[^&]+/, `sig=${'A'.repeat(43)}`)).expect(404);
    await beto.agent.get(url.replace(/exp=\d+/, 'exp=99999999999')).expect(404);
    // La firma de un estado no sirve para pedirlo como adjunto de chat.
    await beto.agent.get(url.replace('/media/e/', '/media/a/')).expect(404);

    // Si Beto sale de la agenda de Ana, deja de verlo al instante aunque tenga la URL.
    await ana.agent.delete(`/contacts/${beto.id}`).expect(204);
    await beto.agent.get(url).expect(404);
    expect(((await beto.agent.get('/statuses').expect(200)).body as StatusOverviewDto).feed).toEqual([]);
    await ana.agent.post('/contacts').send({ tag: 'beto.estm' }).expect(201);
    await beto.agent.get(url).expect(200);
  });

  it('publica un video convertido (sin metadatos) y limita su duración', async () => {
    const created = (await upload(ana, MP4, { kind: 'video', caption: 'Recital' }).expect(201)).body as StatusDto;
    expect(created.media).toMatchObject({ mimeType: 'video/mp4', durationMs: 9000 });
    expect(ctx.transcoder.calls.at(-1)).toBe('video');
    const played = await beto.agent.get(created.media?.url ?? '').buffer(true).parse(binary).expect(200);
    expect((played.body as Buffer).toString()).toBe('video-convertido');

    const tooLong = await upload(ana, Buffer.concat([MP4, Buffer.from('MUY-LARGO')]), { kind: 'video' }).expect(400);
    expect((tooLong.body as { message: string }).message).toContain(String(STATUS_VIDEO_MAX_SECONDS));
  });

  it('valida el contenido real, el antivirus y los campos', async () => {
    await upload(ana, Buffer.from('<svg onload="alert(1)"/>'), { kind: 'image' }).expect(400);
    await upload(ana, Buffer.from('%PDF-1.7 no soy un video'), { kind: 'video' }).expect(400);
    await upload(ana, await photoWithExif(), { kind: 'file' }).expect(400);
    await upload(ana, await photoWithExif(), { kind: 'image', ownerId: beto.id }).expect(400);
    await upload(ana, null, { kind: 'image' }).expect(400);

    const infected = await upload(ana, Buffer.concat([await photoWithExif(), Buffer.from(EICAR)]), { kind: 'image' }).expect(400);
    expect((infected.body as { code: string }).code).toBe('MALWARE_DETECTED');
  });

  it('al vencer, el archivo deja de servirse y la limpieza lo borra del disco', async () => {
    const created = (await upload(ana, await photoWithExif(), { kind: 'image' }).expect(201)).body as StatusDto;
    const before = storedFiles().length;
    await ctx.db
      .update(statuses)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(statuses.id, created.id));
    await beto.agent.get(created.media?.url ?? '').expect(404);

    await ctx.app.get(StatusesCleanupService).purgeExpired();
    expect(storedFiles().length).toBe(before - 1);
    await ana.agent.get(created.media?.url ?? '').expect(404);
  });
});
