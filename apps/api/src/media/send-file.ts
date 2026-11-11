import type { Request, Response } from 'express';

/** Cabecera Content-Disposition segura (RFC 6266): nombre ASCII de respaldo + nombre UTF-8 codificado. */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Envía un archivo desde memoria con soporte de rangos (`Range: bytes=a-b`), que los navegadores
 * usan para adelantar audio y video. Solo se admite un rango por pedido.
 */
export function sendBuffer(
  request: Request,
  response: Response,
  file: { data: Buffer; mimeType: string; disposition: 'inline' | 'attachment'; fileName: string },
  maxAgeSeconds: number,
): void {
  const total = file.data.length;
  response.setHeader('Content-Type', file.mimeType);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Disposition', contentDisposition(file.disposition, file.fileName));
  // "private": solo la caché del navegador de esta persona, nunca proxies compartidos.
  response.setHeader('Cache-Control', `private, max-age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  response.setHeader('Accept-Ranges', 'bytes');
  // El archivo no puede ejecutar nada aunque se abra directo en una pestaña.
  response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");

  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (!range || (range[1] === '' && range[2] === '')) {
    response.setHeader('Content-Length', String(total));
    response.status(200).end(file.data);
    return;
  }

  let start: number;
  let end: number;
  if (range[1] === '') {
    // "bytes=-500": los últimos 500 bytes
    const suffix = Number(range[2]);
    start = Math.max(0, total - suffix);
    end = total - 1;
  } else {
    start = Number(range[1]);
    end = range[2] === '' ? total - 1 : Math.min(Number(range[2]), total - 1);
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) {
    response.setHeader('Content-Range', `bytes */${total}`);
    response.status(416).end();
    return;
  }
  response.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
  response.setHeader('Content-Length', String(end - start + 1));
  response.status(206).end(file.data.subarray(start, end + 1));
}
