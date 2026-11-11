import { BadRequestException, Injectable, PayloadTooLargeException, ServiceUnavailableException } from '@nestjs/common';
import { ALLOWED_FILE_EXTENSIONS, FILE_NAME_MAX_LENGTH, UPLOAD_MAX_BYTES, VOICE_MAX_SECONDS, type UploadKind } from '@qemzagram/shared';
import sharp from 'sharp';
import { AuditService } from '../common/audit.service';
import { AntivirusPort, AntivirusUnavailableError } from './antivirus.port';
import { sniff, type SniffedType } from './content-sniffer';
import { MediaRejectedError, MediaTranscoder, type TranscodeTarget } from './transcoder.port';

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

interface DocumentRule {
  mimeType: string;
  matches: (type: SniffedType, data: Buffer) => boolean;
}

const isPdf = (type: SniffedType) => type.format === 'pdf';
const isText = (type: SniffedType) => type.family === 'text';
const isZip = (type: SniffedType) => type.format === 'zip';
/** Office moderno (docx/xlsx/pptx): ZIP con "[Content_Types].xml" y SIN proyecto de macros VBA. */
const isOoxml = (type: SniffedType, data: Buffer) =>
  isZip(type) && data.includes('[Content_Types].xml') && !data.includes('vbaProject.bin');
/** OpenDocument (odt/ods/odp): ZIP cuyo archivo "mimetype" declara el tipo correspondiente, sin macros. */
const isOdf = (kind: string) => (type: SniffedType, data: Buffer) =>
  isZip(type) && data.includes(`application/vnd.oasis.opendocument.${kind}`) && !data.includes('Basic/');

const DOCUMENT_RULES: Record<string, DocumentRule> = {
  pdf: { mimeType: 'application/pdf', matches: isPdf },
  docx: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', matches: isOoxml },
  xlsx: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', matches: isOoxml },
  pptx: { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', matches: isOoxml },
  odt: { mimeType: 'application/vnd.oasis.opendocument.text', matches: isOdf('text') },
  ods: { mimeType: 'application/vnd.oasis.opendocument.spreadsheet', matches: isOdf('spreadsheet') },
  odp: { mimeType: 'application/vnd.oasis.opendocument.presentation', matches: isOdf('presentation') },
  zip: { mimeType: 'application/zip', matches: isZip },
  txt: { mimeType: 'text/plain; charset=utf-8', matches: isText },
  csv: { mimeType: 'text/csv; charset=utf-8', matches: isText },
};

/**
 * Nombre visible seguro: sin carpetas ("../"), sin caracteres de control ni de dirección de texto
 * (que permiten disfrazar "gpj.exe" como "exe.jpg"), recortado y nunca vacío.
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const clean = base
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/^[.\s]+/, '')
    .trim();
  if (!clean) return 'archivo';
  if (clean.length <= FILE_NAME_MAX_LENGTH) return clean;
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
  return clean.slice(0, FILE_NAME_MAX_LENGTH - extension.length) + extension;
}

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
    private readonly transcoder: MediaTranscoder,
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
      case 'file':
        return this.processDocument(input, type);
      case 'audio':
        if (type.family !== 'audio-video') throw rejected('INVALID_MEDIA', 'El archivo no es un audio válido');
        return this.transcode(input.buffer, 'voice', VOICE_MAX_SECONDS);
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

  /** Audio y video SIEMPRE se convierten (quita metadatos como el GPS). Sin ffmpeg, no se aceptan. */
  private async transcode(buffer: Buffer, target: TranscodeTarget, maxSeconds: number): Promise<ProcessedMedia> {
    if (!(await this.transcoder.isAvailable())) {
      throw new ServiceUnavailableException({ code: 'MEDIA_UNAVAILABLE', message: 'Las notas de voz y los videos no están disponibles en este momento' });
    }
    try {
      const result = await this.transcoder.transcode(buffer, target, maxSeconds);
      return { data: result.data, mimeType: result.mimeType, name: null, width: result.width, height: result.height, durationMs: result.durationMs };
    } catch (error) {
      if (error instanceof MediaRejectedError) throw rejected(error.code, error.message);
      throw error;
    }
  }

  /**
   * Documentos: no se pueden re-codificar sin romperlos, así que se exige que la extensión
   * (de una lista cerrada) coincida con el CONTENIDO real, se bloquean macros y se fuerzan a descarga.
   */
  processDocument(input: UploadedInput, type: SniffedType): ProcessedMedia {
    const name = sanitizeFileName(input.originalName);
    const extension = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
    const rule = DOCUMENT_RULES[extension];
    if (!rule) throw rejected('UNSUPPORTED_FILE', `Solo se permiten documentos: ${ALLOWED_FILE_EXTENSIONS.join(', ')}`);
    if (!rule.matches(type, input.buffer)) throw rejected('FILE_MISMATCH', 'El contenido del archivo no coincide con su extensión');
    return { data: input.buffer, mimeType: rule.mimeType, name, width: null, height: null, durationMs: null };
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
