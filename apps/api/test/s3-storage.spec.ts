import sharp from 'sharp';
import type { MessageDto } from '@qemzagram/shared';
import { loadEnv } from '../src/config/env';
import { BlobStorage } from '../src/storage/blob-storage.port';
import { BlobStorageError, S3BlobStorage } from '../src/storage/s3-blob-storage';
import { signS3Request } from '../src/storage/s3-signer';
import { FAKE_S3_CREDENTIALS, FakeS3 } from './support/fake-s3';
import { binary } from './support/files';
import { createTestApp, signUp, type TestContext } from './support/test-app';

const KEY = '0b7c6b0e-3a4f-4a8e-9a51-6f1f5a3c2d10';

describe('Firma AWS Signature V4', () => {
  it('coincide con el ejemplo oficial de la documentación de AWS (GET de un objeto)', () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html → "Example: GET Object"
    const headers = signS3Request(
      {
        method: 'GET',
        url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
        headers: { Range: 'bytes=0-9' },
        payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        date: new Date('2013-05-24T00:00:00Z'),
      },
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' },
    );
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });
});

describe('Adaptador S3 (Backblaze B2, R2, MinIO)', () => {
  const s3 = new FakeS3();
  let storage: S3BlobStorage;

  beforeAll(async () => {
    await s3.start();
    storage = new S3BlobStorage({ ...FAKE_S3_CREDENTIALS, endpoint: s3.endpoint, bucket: 'qz-media', prefix: 'media/', forcePathStyle: true });
  });
  afterAll(async () => {
    await s3.stop();
  });

  it('guarda, lee y borra objetos con peticiones firmadas', async () => {
    const data = Buffer.from('bytes-ya-cifrados');
    await storage.put(KEY, data);
    expect(s3.objects.get(`/qz-media/media/${KEY}`)?.equals(data)).toBe(true);
    expect((await storage.get(KEY))?.equals(data)).toBe(true);
    await storage.delete(KEY);
    expect(await storage.get(KEY)).toBeNull(); // no existe → null (no error)
    await storage.delete(KEY); // borrar dos veces no falla
  });

  it('con credenciales equivocadas el servidor rechaza la firma y el error no revela el secreto', async () => {
    const wrong = new S3BlobStorage({ ...FAKE_S3_CREDENTIALS, secretAccessKey: 'otra-clave', endpoint: s3.endpoint, bucket: 'qz-media', prefix: 'media/', forcePathStyle: true });
    const error: unknown = await wrong.put(KEY, Buffer.from('x')).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BlobStorageError);
    expect((error as Error).message).toContain('403');
    expect((error as Error).message).not.toContain('otra-clave');
    expect((error as Error).message).not.toContain(FAKE_S3_CREDENTIALS.secretAccessKey);
  });

  it('un error del proveedor se informa (no se toma como "no existe")', async () => {
    s3.failNext = 500;
    await expect(storage.get(KEY)).rejects.toBeInstanceOf(BlobStorageError);
    s3.failNext = 503;
    await expect(storage.delete(KEY)).rejects.toBeInstanceOf(BlobStorageError);
  });

  it('sin respuesta del servidor falla con un error claro', async () => {
    const down = new S3BlobStorage({ ...FAKE_S3_CREDENTIALS, endpoint: 'http://127.0.0.1:1', bucket: 'qz-media', prefix: 'media/', forcePathStyle: true });
    await expect(down.get(KEY)).rejects.toBeInstanceOf(BlobStorageError);
  });

  it('arma URLs de estilo ruta y de subdominio, y solo acepta claves UUID', () => {
    const config = { ...FAKE_S3_CREDENTIALS, endpoint: 'https://s3.us-east-005.backblazeb2.com', bucket: 'qz-media', prefix: 'media/' };
    expect(new S3BlobStorage({ ...config, forcePathStyle: true }).objectUrl(KEY).href).toBe(`https://s3.us-east-005.backblazeb2.com/qz-media/media/${KEY}`);
    expect(new S3BlobStorage({ ...config, forcePathStyle: false }).objectUrl(KEY).href).toBe(`https://qz-media.s3.us-east-005.backblazeb2.com/media/${KEY}`);
    expect(() => storage.objectUrl('../../otro-bucket/secreto')).toThrow('Clave de almacenamiento inválida');
    expect(() => storage.objectUrl(`${KEY}?x=1`)).toThrow('Clave de almacenamiento inválida');
  });

  it('valida la configuración: variables obligatorias y https en producción', () => {
    const base = { DATABASE_URL: 'pglite://memory', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_TICKET_SECRET: 'b'.repeat(32), PASSWORD_PEPPER: 'c'.repeat(16), MESSAGE_ENC_KEY: Buffer.alloc(32).toString('base64') };
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET: Obligatoria/);
    const s3Env = { ...base, STORAGE_DRIVER: 's3', S3_ENDPOINT: 'http://minio:9000', S3_BUCKET: 'qz-media', S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'secreto' };
    expect(loadEnv(s3Env).STORAGE_DRIVER).toBe('s3');
    expect(() => loadEnv({ ...s3Env, NODE_ENV: 'production', CLAMAV_HOST: 'clamav' })).toThrow(/S3_ENDPOINT: En producción/);
    expect(() => loadEnv({ ...s3Env, S3_BUCKET: 'Bucket_Malo' })).toThrow(/Nombre de bucket inválido/);
  });
});

describe('La app completa con STORAGE_DRIVER=s3', () => {
  const s3 = new FakeS3();
  let ctx: TestContext;

  beforeAll(async () => {
    await s3.start();
    ctx = await createTestApp({
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: s3.endpoint,
      S3_REGION: FAKE_S3_CREDENTIALS.region,
      S3_BUCKET: 'qz-media',
      S3_ACCESS_KEY_ID: FAKE_S3_CREDENTIALS.accessKeyId,
      S3_SECRET_ACCESS_KEY: FAKE_S3_CREDENTIALS.secretAccessKey,
    });
  });
  afterAll(async () => {
    await ctx.close();
    await s3.stop();
    // Que las demás suites (en el mismo proceso) vuelvan al disco local.
    process.env.STORAGE_DRIVER = 'local';
  });

  it('los adjuntos se guardan cifrados en el bucket y se sirven solo por la API', async () => {
    expect(ctx.app.get(BlobStorage)).toBeInstanceOf(S3BlobStorage);
    const ana = await signUp(ctx, 'ana.s3', 'An#Bucket2026-clave');
    const beto = await signUp(ctx, 'beto.s3', 'Be#Bucket2026-clave');
    await ana.agent.post('/contacts').send({ tag: beto.tag }).expect(201);
    const chat = ((await ana.agent.post('/chats/direct').send({ tag: beto.tag }).expect(200)).body as { id: string }).id;

    const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#d91e36' } }).jpeg().toBuffer();
    const sent = (await ana.agent.post(`/chats/${chat}/attachments`).field('kind', 'image').attach('file', photo, { filename: 'foto.jpg', contentType: 'image/jpeg' }).expect(201)).body as MessageDto;

    expect(s3.objects.size).toBe(1);
    const [[path, stored]] = [...s3.objects.entries()] as [[string, Buffer]];
    expect(path).toMatch(/^\/qz-media\/media\/[0-9a-f-]{36}$/);
    const served = await beto.agent.get(sent.attachment?.url ?? '').buffer(true).parse(binary).expect(200);
    const image = served.body as Buffer;
    expect(image.subarray(0, 4).toString('latin1')).toBe('RIFF'); // la API la entrega descifrada (WebP)…
    expect(stored.subarray(0, 4).toString('latin1')).not.toBe('RIFF'); // …pero el proveedor solo tiene bytes cifrados
    expect(stored.includes(image.subarray(0, 64))).toBe(false);
  });
});
