import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { MessageDto, StickerDto } from '@qemzagram/shared';
import { StickersRepository } from '../src/database/repositories/stickers.repository';
import { binary } from './support/files';
import { createTestApp, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Stickers: pack general y "Mis stickers"', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let chatId: string;

  const png = (width = 800, height = 400) =>
    sharp({ create: { width, height, channels: 4, background: { r: 217, g: 30, b: 54, alpha: 1 } } }).png().toBuffer();
  const createSticker = (user: TestUser, data: Buffer) =>
    user.agent.post('/stickers').attach('file', data, { filename: 'sticker.png', contentType: 'image/png' });

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.stk', 'An#Stickers2026-c');
    beto = await signUp(ctx, 'beto.stk', 'Be#Stickers2026-c');
    carla = await signUp(ctx, 'carla.stk', 'Ca#Stickers2026-c');
    await ana.agent.post('/contacts').send({ tag: 'beto.stk' }).expect(201);
    chatId = ((await ana.agent.post('/chats/direct').send({ tag: 'beto.stk' }).expect(200)).body as { id: string }).id;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('envía stickers del pack general y valida el código', async () => {
    const sent = await ana.agent.post(`/chats/${chatId}/stickers`).send({ code: 'mate' }).expect(201);
    expect(sent.body as MessageDto).toMatchObject({ sticker: 'mate', attachment: null, body: '' });
    const history = await beto.agent.get(`/chats/${chatId}/messages`).expect(200);
    expect((history.body as MessageDto[]).at(-1)?.sticker).toBe('mate');

    await ana.agent.post(`/chats/${chatId}/stickers`).send({ code: '../../etc/passwd' }).expect(400);
    await ana.agent.post(`/chats/${chatId}/stickers`).send({ code: 'hola', extra: true }).expect(400);
    await ana.agent.post(`/chats/${chatId}/stickers`).send({ code: 'hola', stickerId: randomUUID() }).expect(400);
    await ana.agent.post(`/chats/${chatId}/stickers`).send({}).expect(400);
    await carla.agent.post(`/chats/${chatId}/stickers`).send({ code: 'hola' }).expect(404); // no es miembro
  });

  it('crea un sticker propio: WebP 512×512 con transparencia, visible solo para su dueño', async () => {
    const created = await createSticker(ana, await png()).expect(201);
    const sticker = created.body as StickerDto;
    expect(sticker.url).toMatch(/^\/media\/s\/[0-9a-f-]{36}\?exp=\d+&sig=/);

    const image = await ana.agent.get(sticker.url).buffer(true).parse(binary).expect(200);
    const metadata = await sharp(image.body as Buffer).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 512, height: 512, hasAlpha: true });

    await beto.agent.get(sticker.url).expect(404); // con la URL firmada, pero no es el dueño
    const mine = await ana.agent.get('/stickers').expect(200);
    expect((mine.body as StickerDto[]).map((item) => item.id)).toContain(sticker.id);
    expect((await beto.agent.get('/stickers').expect(200)).body).toEqual([]);
  });

  it('enviar un sticker propio manda una COPIA que sobrevive aunque se borre el original', async () => {
    const sticker = (await createSticker(ana, await png(300, 300)).expect(201)).body as StickerDto;
    const sent = await ana.agent.post(`/chats/${chatId}/stickers`).send({ stickerId: sticker.id }).expect(201);
    const attachment = (sent.body as MessageDto).attachment;
    expect(attachment).toMatchObject({ kind: 'sticker', mimeType: 'image/webp', width: 512, height: 512 });

    // otra persona no puede usar, ni ver, ni borrar stickers ajenos
    await ana.agent.post('/contacts').send({ tag: 'carla.stk' }).expect(201);
    await beto.agent.post('/contacts').send({ tag: 'ana.stk' }).expect(201);
    await beto.agent.post(`/chats/${chatId}/stickers`).send({ stickerId: sticker.id }).expect(404);
    await beto.agent.delete(`/stickers/${sticker.id}`).expect(404);

    await ana.agent.delete(`/stickers/${sticker.id}`).expect(204);
    await ana.agent.delete(`/stickers/${sticker.id}`).expect(404);
    await beto.agent.get(attachment?.url ?? '').expect(200); // el mensaje enviado sigue viéndose
  });

  it('valida la imagen, el tamaño y el límite de stickers por persona', async () => {
    await createSticker(ana, Buffer.from('<svg onload="alert(1)"/>')).expect(400);
    await createSticker(ana, Buffer.from('%PDF-1.7')).expect(400);
    await ana.agent.post('/stickers').expect(400);
    const huge = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(6 * 1024 * 1024)]);
    expect((await createSticker(ana, huge)).status).toBe(413);

    // se llena la colección de carla directamente en la base (más rápido que 60 subidas)
    const repository = ctx.app.get(StickersRepository);
    for (let index = 0; index < 60; index++) await repository.create(randomUUID(), carla.id, randomUUID());
    const full = await createSticker(carla, await png()).expect(400);
    expect(full.body.code).toBe('STICKER_LIMIT');
  });
});
