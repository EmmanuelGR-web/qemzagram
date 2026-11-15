import {
  decryptFile,
  encryptFile,
  openMessage,
  sealMessage,
  type ConversationDto,
  type E2eeFileRef,
  type MessageDto,
} from '@qemzagram/shared';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import request from 'supertest';
import { CryptoService } from '../src/common/crypto.service';
import { reportEvidence, reports } from '../src/database/schema';
import { evidenceAad } from '../src/media/media.service';
import { BlobStorage } from '../src/storage/blob-storage.port';
import { recipientsFor, setupE2ee, type E2eeDevice } from './support/e2ee-client';
import { binary, storedFiles } from './support/files';
import { createTestApp, EICAR, ORIGIN, signUp, type TestContext, type TestUser } from './support/test-app';

describe('Adjuntos cifrados de extremo a extremo', () => {
  let ctx: TestContext;
  let ana: TestUser;
  let beto: TestUser;
  let carla: TestUser;
  let chat: string;
  let anaDevice: E2eeDevice;
  let betoDevice: E2eeDevice;
  let png: Buffer;

  const befriend = async (a: TestUser, b: TestUser) => {
    await a.agent.post('/contacts').send({ tag: b.tag }).expect(201);
    await b.agent.post('/contacts').send({ tag: a.tag }).expect(201);
  };

  /** Lo que hace el navegador: cifrar el archivo, armar el contenido con la clave y sellar el mensaje. */
  const prepare = async (data: Buffer, file: Omit<E2eeFileRef, 'id' | 'key' | 'size'>, caption = '') => {
    const id = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const encrypted = await encryptFile(data, attachmentId);
    const content = { t: 'file' as const, body: caption, file: { ...file, id: attachmentId, key: encrypted.key, size: data.length } };
    const sealed = await sealMessage(content, { conversationId: chat, objectId: id, senderId: ana.id }, anaDevice, await recipientsFor(anaDevice, chat));
    return { meta: { id, attachmentId, envelope: sealed.envelope, commitment: sealed.commitment }, blob: Buffer.from(encrypted.blob), content };
  };
  const upload = (user: TestUser, meta: unknown, blob: Buffer | null, conversationId = chat) => {
    const call = user.agent.post(`/chats/${conversationId}/e2ee/attachments`).field('meta', typeof meta === 'string' ? meta : JSON.stringify(meta));
    return blob ? call.attach('file', blob, { filename: 'cifrado.bin', contentType: 'application/octet-stream' }) : call;
  };
  const openAs = (device: E2eeDevice, message: MessageDto) => {
    if (!message.e2ee) throw new Error('sin sobre');
    return openMessage(message.e2ee.envelope, message.e2ee.commitment, { conversationId: chat, objectId: message.id, senderId: message.senderId }, { userId: device.user.id, keyId: device.keyId, privateKey: device.privateKey }, anaDevice.publicJwk);
  };
  const download = async (user: TestUser, url: string) => (await user.agent.get(url).buffer(true).parse(binary).expect(200));

  beforeAll(async () => {
    ctx = await createTestApp();
    ana = await signUp(ctx, 'ana.e2efile', 'An#Archivo2026-ok');
    beto = await signUp(ctx, 'beto.e2efile', 'Be#Archivo2026-ok');
    carla = await signUp(ctx, 'carla.e2efile', 'Ca#Archivo2026-ok');
    await befriend(ana, beto);
    chat = ((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200)).body as ConversationDto).id;
    anaDevice = await setupE2ee(ana);
    betoDevice = await setupE2ee(beto);
    png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#d11' } }).png().toBuffer();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('en un chat de extremo a extremo ya no se aceptan adjuntos que el servidor pueda leer', async () => {
    const legacy = await ana.agent.post(`/chats/${chat}/attachments`).field('kind', 'image').attach('file', png, { filename: 'foto.png', contentType: 'image/png' }).expect(409);
    expect(legacy.body.code).toBe('E2EE_REQUIRED');
    await ana.agent.post(`/chats/${chat}/stickers`).send({ stickerId: crypto.randomUUID() }).expect(409);
  });

  it('el servidor guarda solo bytes cifrados (dos capas) y quien recibe recupera el archivo exacto', async () => {
    const scansBefore = ctx.antivirus.scanned;
    const { meta, blob } = await prepare(png, { kind: 'image', mime: 'image/png', name: null, w: 8, h: 6, dur: null }, 'mirá');
    const sent = (await upload(ana, meta, blob).expect(201)).body as MessageDto;
    expect(sent).toMatchObject({ id: meta.id, body: '' });
    // El servidor no sabe qué es: para él es un "archivo" opaco.
    expect(sent.attachment).toMatchObject({ id: meta.attachmentId, e2ee: true, kind: 'file', mimeType: 'application/octet-stream', name: null, width: null });
    expect(ctx.antivirus.scanned).toBe(scansBefore);

    // Beto abre el mensaje, descarga los bytes cifrados y los descifra con la clave del mensaje.
    const listed = (await beto.agent.get(`/chats/${chat}/messages`).expect(200)).body as MessageDto[];
    const received = listed.find((message) => message.id === meta.id);
    if (!received?.attachment) throw new Error('No llegó');
    const opened = await openAs(betoDevice, received);
    if (opened.content.t !== 'file') throw new Error('No es un archivo');
    expect(opened.content.body).toBe('mirá');
    const response = await download(beto, received.attachment.url);
    expect(response.headers['content-type']).toContain('application/octet-stream');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const plain = Buffer.from(await decryptFile(response.body as Buffer, opened.content.file.key, received.attachment.id));
    expect(plain.equals(png)).toBe(true);

    // Lo que hay en disco no contiene el archivo original (ni siquiera quitando la capa del servidor).
    const onDisk = storedFiles().map((path) => readFileSync(path));
    expect(onDisk.some((data) => data.includes(png.subarray(0, 16)))).toBe(false);

    // Carla no es miembro: no puede bajarlo aunque tenga la URL.
    await carla.agent.get(received.attachment.url).expect(404);
  });

  it('un archivo con virus pasa cifrado (el servidor no lo puede ver): la protección queda en el dispositivo', async () => {
    const { meta, blob } = await prepare(Buffer.from(`documento ${EICAR}`), { kind: 'file', mime: 'text/plain', name: 'nota.txt', w: null, h: null, dur: null });
    await upload(ana, meta, blob).expect(201);
  });

  it('valida la entrada, los permisos, los destinatarios y los ids', async () => {
    const { meta, blob } = await prepare(png, { kind: 'image', mime: 'image/png', name: null, w: 8, h: 6, dur: null });
    await request(ctx.app.getHttpServer()).post(`/chats/${chat}/e2ee/attachments`).set('Origin', ORIGIN).field('meta', JSON.stringify(meta)).attach('file', blob, 'x.bin').expect(401);
    await upload(carla, meta, blob).expect(404);
    await upload(ana, '{no es json', blob).expect(400);
    await upload(ana, { ...meta, kind: 'image' }, blob).expect(400);
    await upload(ana, { ...meta, attachmentId: meta.id }, blob).expect(400);
    await upload(ana, meta, null).expect(400);
    await upload(ana, meta, Buffer.alloc(10)).expect(400);
    await ana.agent.post(`/chats/${chat}/e2ee/attachments`).attach('file', blob, 'x.bin').expect(400);

    // Destinatarios incompletos: falta Beto.
    const recipients = (await recipientsFor(anaDevice, chat)).filter((recipient) => recipient.userId === ana.id);
    const partial = await sealMessage({ t: 'text', body: 'x' }, { conversationId: chat, objectId: meta.id, senderId: ana.id }, anaDevice, recipients);
    expect((await upload(ana, { ...meta, envelope: partial.envelope }, blob).expect(409)).body.code).toBe('E2EE_KEYS_CHANGED');

    await upload(ana, meta, blob).expect(201);
    // Mismo id de mensaje o de adjunto: no se pisa nada.
    await upload(ana, meta, blob).expect(409);
    const again = await prepare(png, { kind: 'image', mime: 'image/png', name: null, w: 8, h: 6, dur: null });
    await upload(ana, { ...again.meta, attachmentId: meta.attachmentId }, again.blob).expect(409);
  });

  it('el contenido declarado se valida: tipos fuera de la lista cerrada o documentos sin nombre no se pueden sellar', async () => {
    await expect(prepare(png, { kind: 'image', mime: 'text/html', name: null, w: 1, h: 1, dur: null })).rejects.toThrow();
    await expect(prepare(png, { kind: 'file', mime: 'application/pdf', name: null, w: null, h: null, dur: null })).rejects.toThrow();
    await expect(prepare(png, { kind: 'file', mime: 'application/x-msdownload', name: 'virus.exe', w: null, h: null, dur: null })).rejects.toThrow();
  });

  describe('denuncias con adjuntos cifrados', () => {
    beforeEach(async () => {
      await ctx.db.delete(reports);
    });

    it('con la clave revelada (y franqueada), soporte recibe una copia del archivo con su tipo REAL', async () => {
      const { meta, blob } = await prepare(png, { kind: 'image', mime: 'image/png', name: null, w: 8, h: 6, dur: null }, 'esto');
      const sent = (await upload(ana, meta, blob).expect(201)).body as MessageDto;
      const { reveal } = await openAs(betoDevice, sent);
      await beto.agent.post('/reports').send({ userId: ana.id, reason: 'sexual', evidence: [{ type: 'message', id: sent.id, reveal }] }).expect(201);

      const [evidence] = await ctx.db.select().from(reportEvidence);
      expect(evidence).toMatchObject({ verified: true, kind: 'image', mimeType: 'image/png', width: 8, height: 6, sizeBytes: png.length });
      const serverCrypto = ctx.app.get(CryptoService);
      expect(serverCrypto.decryptText(evidence?.bodyEncrypted ?? '', evidenceAad(evidence?.id ?? ''))).toBe('esto');
      const stored = await ctx.app.get(BlobStorage).get(evidence?.storageKey ?? '');
      expect(stored && serverCrypto.decryptBlob(stored, evidenceAad(evidence?.id ?? '')).equals(png)).toBe(true);
    });

    it('la copia para soporte SÍ pasa por el antivirus: si tiene malware no se guarda el archivo', async () => {
      const { meta, blob } = await prepare(Buffer.from(`documento ${EICAR}`), { kind: 'file', mime: 'text/plain', name: 'nota.txt', w: null, h: null, dur: null });
      const sent = (await upload(ana, meta, blob).expect(201)).body as MessageDto;
      const { reveal } = await openAs(betoDevice, sent);
      await beto.agent.post('/reports').send({ userId: ana.id, reason: 'spam', evidence: [{ type: 'message', id: sent.id, reveal }] }).expect(201);
      const [evidence] = await ctx.db.select().from(reportEvidence);
      expect(evidence).toMatchObject({ kind: 'malware', storageKey: null, verified: true });
    });

    it('si el archivo no es lo que dice ser, soporte solo lo puede descargar (no se muestra)', async () => {
      const fakeImage = Buffer.from('%PDF-1.7 esto no es una imagen');
      const { meta, blob } = await prepare(fakeImage, { kind: 'image', mime: 'image/png', name: null, w: 1, h: 1, dur: null });
      const sent = (await upload(ana, meta, blob).expect(201)).body as MessageDto;
      const { reveal } = await openAs(betoDevice, sent);
      await beto.agent.post('/reports').send({ userId: ana.id, reason: 'spam', evidence: [{ type: 'message', id: sent.id, reveal }] }).expect(201);
      const [evidence] = await ctx.db.select().from(reportEvidence);
      expect(evidence).toMatchObject({ kind: 'file', mimeType: 'application/octet-stream', verified: true });
    });
  });
});
