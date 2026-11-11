import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { ENV, type AppEnv } from '../config/env';
import { assertBlobKey, BlobStorage } from './blob-storage.port';

/**
 * Almacenamiento en disco local (desarrollo y servidores chicos).
 * - La carpeta está FUERA de la carpeta pública de fotos de perfil: ningún archivo se sirve directo.
 * - Los archivos se reparten en subcarpetas por los 2 primeros caracteres de la clave.
 */
@Injectable()
export class LocalBlobStorage extends BlobStorage {
  private readonly root: string;

  constructor(@Inject(ENV) env: AppEnv) {
    super();
    this.root = resolve(env.MEDIA_DIR);
    const publicDir = resolve(env.UPLOAD_DIR);
    const inside = relative(publicDir, this.root);
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
      throw new Error('MEDIA_DIR no puede estar dentro de UPLOAD_DIR (esa carpeta se sirve en público)');
    }
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(join(path, '..'), { recursive: true });
    // "wx": falla si ya existe (nunca se pisa un archivo).
    await writeFile(path, data, { mode: 0o640, flag: 'wx' });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private pathFor(key: string): string {
    assertBlobKey(key);
    return join(this.root, key.slice(0, 2), key);
  }
}
