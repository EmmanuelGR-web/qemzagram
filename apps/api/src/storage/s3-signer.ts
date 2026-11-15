import { createHash, createHmac } from 'node:crypto';

/**
 * Firma AWS Signature Version 4 para la API S3 (la usan AWS, Backblaze B2, Cloudflare R2, MinIO…).
 * Implementación mínima y sin dependencias: solo lo que hace falta para PUT/GET/DELETE de un objeto.
 * Referencia: https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html
 */
export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface SignInput {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  url: URL;
  /** Encabezados que se firman (además de host, x-amz-date y x-amz-content-sha256, que se agregan solos). */
  headers?: Record<string, string>;
  /** SHA-256 en hexadecimal del cuerpo (vacío = hash de cadena vacía). */
  payloadHash: string;
  date: Date;
}

export const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/** Codificación de URI de AWS: todo excepto A-Z a-z 0-9 - _ . ~ (y "/" en la ruta). */
export function awsUriEncode(value: string, keepSlash: boolean): string {
  return Array.from(Buffer.from(value, 'utf8'))
    .map((byte) => {
      const char = String.fromCharCode(byte);
      if (/[A-Za-z0-9\-_.~]/.test(char) || (keepSlash && char === '/')) return char;
      return `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
}

/** "20130524T000000Z" */
export const amzDate = (date: Date): string => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Devuelve los encabezados a enviar, incluido `Authorization`. */
export function signS3Request(input: SignInput, credentials: S3Credentials): Record<string, string> {
  const stamp = amzDate(input.date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value.trim()])),
    host: input.url.host,
    'x-amz-content-sha256': input.payloadHash,
    'x-amz-date': stamp,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalQuery = [...input.url.searchParams.entries()]
    .map(([name, value]) => [awsUriEncode(name, false), awsUriEncode(value, false)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
  const canonicalRequest = [
    input.method,
    // La ruta ya viene codificada por quien arma la URL (ver S3BlobStorage); se usa tal cual.
    input.url.pathname,
    canonicalQuery,
    names.map((name) => `${name}:${headers[name]}\n`).join(''),
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const scope = `${day}/${credentials.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  // "host" lo pone fetch solo; el resto viaja tal cual.
  const { host: _host, ...toSend } = headers;
  return {
    ...toSend,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
