import { BadRequestException, Injectable, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { UPLOAD_MAX_BYTES, type UploadKind } from '@qemzagram/shared';
import sharp from 'sharp';
import { AuditService } from '../common/audit.service';
import { AntivirusPort, AntivirusUnavailableError } from './antivirus.port';
import { sniff } from './content-sniffer';

/** Resultado listo para guardar: el contenido ya fue validado, analizado y re-codificado. */
export interface ProcessedMedia {
  data: Buffer;
  mimeType: string;
  /** Nombre visible (solo documentos). */
  name: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface UploadedInput {
  buffer: Buffer;
  /** Nombre original que mandó el navegador (no confiable: solo se usa como etiqueta). */
  originalName: string;
}

const IMAGE_MAX_SIDE = 2048;
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif']);

const rejected = (code: string, message: string) => new BadRequestException({ code, message });

/**
 * Pipeline de seguridad de TODA subida al chat:
 *   1. tamaño máximo por tipo
 *   2. tipo REAL por contenido (lista cerrada)
 *   3. antivirus (falla cerrado)
 *   4. re-codificación: elimina metadatos (EXIF/GPS) y neutraliza archivos "políglota"
 */
@Injectable()
export class MediaProcessor {
  constructor(
    private readonly antivirus: AntivirusPort,
    private readonly audit: AuditService,
  ) {}

  async process(kind: UploadKind, input: UploadedInput, userId: string): Promise<ProcessedMedia> {
    if (input.buffer.length === 0) throw rejected('FILE_REQUIRED', 'Adjuntá un archivo');
    if (input.buffer.length > UPLOAD_MAX_BYTES[kind]) {
      throw new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: `El archivo supera el máximo de ${UPLOAD_MAX_BYTES[kind] / 1024 / 1024} MB` });
    }
    const type = sniff(input.buffer);
    if (!type) throw rejected('UNSUPPORTED_FILE', 'Ese tipo de archivo no está permitido');

    await this.scan(input.buffer, userId, kind);

    switch (kind) {
      case 'image':
        if (type.family !== 'image') throw rejected('INVALID_IMAGE', 'El archivo no es una imagen válida');
        return this.processImage(input.buffer);
      default:
        throw rejected('UNSUPPORTED_KIND', 'Ese tipo de adjunto todavía no está disponible');
    }
  }

  /** Analiza con el antivirus. Si encuentra algo, lo audita y rechaza; si no responde, rechaza. */
  async scan(data: Buffer, userId: string, kind: string): Promise<void> {
    let result;
    try {
      result = await this.antivirus.scan(data);
    } catch (error) {
      if (error instanceof AntivirusUnavailableError) {
        throw new ServiceUnavailableException({ code: 'ANTIVIRUS_UNAVAILABLE', message: 'No pudimos analizar el archivo. Probá de nuevo en un rato.' });
      }
      throw error;
    }
    if (!result.clean) {
      await this.audit.log('upload.malware_blocked', { userId, meta: { kind, signature: result.signature } });
      throw rejected('MALWARE_DETECTED', 'El archivo fue bloqueado por el antivirus');
    }
  }

  /** Re-codifica a WebP (sin metadatos), corrige la orientación y limita el tamaño. Conserva animaciones. */
  async processImage(buffer: Buffer): Promise<ProcessedMedia> {
    try {
      const source = sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error', animated: true });
      const metadata = await source.metadata();
      if (!metadata.format || !IMAGE_FORMATS.has(metadata.format)) throw new Error('formato no permitido');
      const animated = (metadata.pages ?? 1) > 1;
      const pipeline = animated ? source : source.rotate();
      const data = await pipeline
        .resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      const result = await sharp(data, { animated: true }).metadata();
      return {
        data,
        mimeType: 'image/webp',
        name: null,
        width: result.width ?? null,
        height: result.pageHeight ?? result.height ?? null,
        durationMs: null,
      };
    } catch {
      throw rejected('INVALID_IMAGE', 'El archivo no es una imagen válida (JPG, PNG, WebP o GIF)');
    }
  }
}
