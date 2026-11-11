import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { ENV, type AppEnv } from '../config/env';

export type ImageKind = 'avatar' | 'cover';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif', 'gif']);
const TARGET_SIZE: Record<ImageKind, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  cover: { width: 1600, height: 600 },
};
const URL_PREFIX = '/uploads/';

@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(ENV) env: AppEnv) {
    this.root = resolve(env.UPLOAD_DIR);
  }

  get directory(): string {
    return this.root;
  }

  /**
   * Valida el contenido REAL del archivo (no la extensión ni el Content-Type que envía el cliente),
   * lo recorta, elimina metadatos (EXIF/GPS) y lo reescribe como WebP con un nombre aleatorio.
   * Re-codificar la imagen neutraliza archivos "políglota" o con código embebido.
   */
  async saveImage(buffer: Buffer, kind: ImageKind): Promise<string> {
    let image: Sharp;
    try {
      image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error' });
      const metadata = await image.metadata();
      if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) throw new Error('formato no permitido');
    } catch {
      throw new BadRequestException({ code: 'INVALID_IMAGE', message: 'El archivo no es una imagen válida (JPG, PNG o WebP)' });
    }

    const { width, height } = TARGET_SIZE[kind];
    const output = await image.rotate().resize(width, height, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toBuffer();

    await mkdir(this.root, { recursive: true });
    const fileName = `${randomUUID()}.webp`;
    await writeFile(join(this.root, fileName), output, { mode: 0o640 });
    return `${URL_PREFIX}${fileName}`;
  }

  /** Borra un archivo propio. Ignora cualquier URL que no sea de nuestro directorio. */
  async remove(url: string | null): Promise<void> {
    if (!url?.startsWith(URL_PREFIX)) return;
    const fileName = basename(url);
    if (!/^[0-9a-f-]{36}\.webp$/.test(fileName)) return;
    try {
      await unlink(join(this.root, fileName));
    } catch {
      // ya no existía: no es un error
    }
  }
}
