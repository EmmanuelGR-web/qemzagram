import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'superagent';

/** Lee la respuesta como bytes crudos (supertest no lo hace solo para audio/video/documentos). */
export function binary(response: Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

/** Todos los archivos guardados en MEDIA_DIR (recursivo). */
export function storedFiles(): string[] {
  const root = process.env.MEDIA_DIR ?? '';
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  return walk(root);
}
