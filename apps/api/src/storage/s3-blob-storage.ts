import { Injectable, Logger } from '@nestjs/common';
import type { AppEnv } from '../config/env';
import { assertBlobKey, BlobStorage } from './blob-storage.port';
import { awsUriEncode, EMPTY_SHA256, sha256Hex, signS3Request, type S3Credentials } from './s3-signer';

const TIMEOUT_MS = 30_000;

/** Error de almacenamiento: nunca incluye credenciales ni el contenido, solo la operación y el código HTTP. */
export class BlobStorageError extends Error {
  constructor(operation: string, status: number) {
    super(`Almacenamiento S3: ${operation} falló (HTTP ${status})`);
  }
}

export interface S3StorageConfig extends S3Credentials {
  endpoint: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
}

export function s3ConfigFromEnv(env: AppEnv): S3StorageConfig {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    // loadEnv ya lo valida; esto solo protege si alguien construye la clase a mano.
    throw new Error('Faltan variables S3_* para STORAGE_DRIVER=s3');
  }
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    prefix: env.S3_PREFIX,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
  };
}

/**
 * Almacenamiento en un servicio compatible con S3 (Backblaze B2, Cloudflare R2, MinIO, AWS S3).
 * - Lo que llega acá YA está cifrado con `CryptoService.encryptBlob`: el proveedor nunca ve el contenido.
 * - El bucket tiene que ser PRIVADO: los archivos se sirven solo a través de la API (URL firmada + permiso).
 * - Cada petición va firmada (SigV4) incluido el hash del cuerpo, así nadie en el medio puede alterarlo.
 */
@Injectable()
export class S3BlobStorage extends BlobStorage {
  private readonly logger = new Logger('S3BlobStorage');

  constructor(private readonly config: S3StorageConfig) {
    super();
  }

  async put(key: string, data: Buffer): Promise<void> {
    const response = await this.send('PUT', key, data);
    if (!response.ok) throw new BlobStorageError('guardar', response.status);
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.send('GET', key);
    if (response.status === 404) return null;
    if (!response.ok) throw new BlobStorageError('leer', response.status);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.send('DELETE', key);
    // S3 responde 204 aunque no exista; algunos compatibles responden 404: tampoco es un error.
    if (!response.ok && response.status !== 404) throw new BlobStorageError('borrar', response.status);
  }

  /** URL del objeto. La clave es un UUID validado: nunca se arma con datos del cliente. */
  objectUrl(key: string): URL {
    assertBlobKey(key);
    const objectPath = awsUriEncode(`${this.config.prefix}${key}`, true);
    const base = new URL(this.config.endpoint);
    const basePath = base.pathname.replace(/\/+$/, '');
    if (this.config.forcePathStyle) {
      return new URL(`${base.protocol}//${base.host}${basePath}/${awsUriEncode(this.config.bucket, false)}/${objectPath}`);
    }
    return new URL(`${base.protocol}//${this.config.bucket}.${base.host}${basePath}/${objectPath}`);
  }

  private async send(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Buffer): Promise<Response> {
    const url = this.objectUrl(key);
    const extra: Record<string, string> = body ? { 'content-type': 'application/octet-stream' } : {};
    const headers = signS3Request(
      { method, url, headers: extra, payloadHash: body ? sha256Hex(body) : EMPTY_SHA256, date: new Date() },
      this.config,
    );
    try {
      return await fetch(url, {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      // Error de red o tiempo agotado: se registra sin la URL completa (puede revelar el bucket).
      this.logger.error(`Sin respuesta del almacenamiento S3 (${method}): ${error instanceof Error ? error.name : 'error'}`);
      throw new BlobStorageError(method === 'PUT' ? 'guardar' : method === 'GET' ? 'leer' : 'borrar', 0);
    }
  }
}
