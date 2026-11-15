import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sha256Hex, signS3Request, type S3Credentials } from '../../src/storage/s3-signer';

export const FAKE_S3_CREDENTIALS: S3Credentials = {
  accessKeyId: 'QZTESTACCESSKEY',
  secretAccessKey: 'qz-test-secret-key-que-nunca-debe-aparecer',
  region: 'us-east-005',
};

const readBody = (request: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

/**
 * Servidor S3 falso en memoria (estilo de ruta: /bucket/clave). Comprueba de verdad la firma SigV4
 * de cada petición y que el hash del cuerpo coincida: si el adaptador firmara mal, respondería 403.
 */
export class FakeS3 {
  readonly objects = new Map<string, Buffer>();
  readonly requests: { method: string; path: string }[] = [];
  /** Si se define, la próxima petición responde con este código (para probar errores). */
  failNext: number | null = null;
  private server: Server | null = null;

  constructor(private readonly credentials: S3Credentials = FAKE_S3_CREDENTIALS) {}

  get endpoint(): string {
    const address = this.server?.address() as AddressInfo | null;
    return `http://127.0.0.1:${address?.port ?? 0}`;
  }

  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handle(request).then(({ status, body }) => {
        response.statusCode = status;
        response.end(body);
      });
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  private async handle(request: IncomingMessage): Promise<{ status: number; body?: Buffer | string }> {
    const body = await readBody(request);
    const path = request.url ?? '/';
    const method = request.method ?? 'GET';
    this.requests.push({ method, path });
    if (this.failNext !== null) {
      const status = this.failNext;
      this.failNext = null;
      return { status, body: '<Error><Code>InternalError</Code></Error>' };
    }
    if (!this.validSignature(request, body)) return { status: 403, body: '<Error><Code>SignatureDoesNotMatch</Code></Error>' };

    switch (method) {
      case 'PUT':
        this.objects.set(path, body);
        return { status: 200 };
      case 'GET': {
        const object = this.objects.get(path);
        return object ? { status: 200, body: object } : { status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' };
      }
      case 'DELETE':
        this.objects.delete(path);
        return { status: 204 };
      default:
        return { status: 405 };
    }
  }

  private validSignature(request: IncomingMessage, body: Buffer): boolean {
    const header = (name: string): string => {
      const value = request.headers[name];
      return Array.isArray(value) ? value.join(',') : (value ?? '');
    };
    const authorization = header('authorization');
    const signed = /SignedHeaders=([^,]+)/.exec(authorization)?.[1]?.split(';') ?? [];
    const payloadHash = header('x-amz-content-sha256');
    if (payloadHash !== sha256Hex(body)) return false;
    const stamp = header('x-amz-date');
    const date = new Date(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`);
    const extra = Object.fromEntries(signed.filter((name) => !['host', 'x-amz-date', 'x-amz-content-sha256'].includes(name)).map((name) => [name, header(name)]));
    const expected = signS3Request(
      { method: request.method as 'GET' | 'PUT' | 'DELETE', url: new URL(`http://${header('host')}${request.url ?? '/'}`), headers: extra, payloadHash, date },
      this.credentials,
    );
    return expected.authorization === authorization;
  }
}
