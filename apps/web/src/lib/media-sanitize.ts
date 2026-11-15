import { ALLOWED_FILE_EXTENSIONS, STICKER_SIZE, UPLOAD_MAX_BYTES, type E2eeFileRef } from '@qemzagram/shared';
import { UserFacingError } from './api';

/**
 * Limpieza de archivos EN EL DISPOSITIVO (Fase 7B). Con el cifrado de extremo a extremo el servidor ya no
 * puede ver los archivos, así que lo que antes hacía él (validar el tipo real y quitar metadatos) pasa acá,
 * ANTES de cifrar:
 * - Fotos: se decodifican y se vuelven a dibujar en un canvas → sale una imagen nueva SIN EXIF/GPS.
 * - Videos MP4/MOV: se anulan las cajas de metadatos (ubicación, cámara, fechas) sin tocar la imagen ni el sonido.
 * - Notas de voz: las graba el propio navegador (no traen ubicación); si son MP4 también se limpian.
 * - Documentos: lista cerrada de extensiones y verificación del contenido (firma del formato).
 * Lo que NO se puede hacer en el dispositivo: antivirus. Ver docs/SEGURIDAD.md §2.7.
 */

export class SanitizeError extends UserFacingError {}

export interface SanitizedFile {
  data: Uint8Array;
  meta: Omit<E2eeFileRef, 'id' | 'key' | 'size'>;
}

const IMAGE_MAX_SIDE = 2560;

/* ---------- Imágenes ---------- */

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Decodifica y vuelve a codificar (WebP si el navegador puede; si no, JPEG o PNG). */
export async function sanitizeImage(source: Blob, kind: 'image' | 'sticker'): Promise<SanitizedFile> {
  let bitmap: ImageBitmap;
  try {
    // "from-image": respeta la rotación del EXIF antes de descartarlo.
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    throw new SanitizeError('No pudimos abrir esa imagen. Probá con una foto JPG, PNG o WebP.');
  }
  const max = kind === 'sticker' ? STICKER_SIZE : IMAGE_MAX_SIDE;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new SanitizeError('Este navegador no puede procesar imágenes');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob = await canvasToBlob(canvas, 'image/webp', 0.85);
  // Safari no codifica WebP: devuelve PNG. Para fotos conviene JPEG (más liviano); los stickers quedan en PNG (transparencia).
  if (!blob || blob.type !== 'image/webp') blob = kind === 'sticker' ? await canvasToBlob(canvas, 'image/png') : await canvasToBlob(canvas, 'image/jpeg', 0.85);
  if (!blob) throw new SanitizeError('No pudimos procesar la imagen');
  if (blob.size > UPLOAD_MAX_BYTES.image) throw new SanitizeError('La imagen es demasiado grande');
  return { data: new Uint8Array(await blob.arrayBuffer()), meta: { kind, mime: blob.type, name: null, w: width, h: height, dur: null } };
}

/* ---------- MP4 / MOV (ISO-BMFF) ---------- */

/** Cajas que solo contienen otras cajas: se recorren para encontrar metadatos adentro. */
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'edts', 'stbl', 'dinf', 'moof', 'traf', 'mvex']);
/** Cajas de metadatos: ubicación (©xyz, ISO 6709), fabricante, modelo, software, XMP… */
const METADATA = new Set(['udta', 'meta', 'uuid', 'xmp_', 'ilst', 'keys']);
/** Cajas con fecha de creación/modificación: se ponen en cero. */
const DATED = new Set(['mvhd', 'tkhd', 'mdhd']);

const typeAt = (bytes: Uint8Array, offset: number) => String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0);

/**
 * Anula los metadatos de un MP4/MOV SIN cambiar tamaños: cada caja de metadatos se convierte en una caja
 * "free" (que los reproductores ignoran) con su contenido en cero. Como nada se mueve de lugar, los índices
 * que apuntan al audio y al video siguen siendo válidos.
 */
export function stripIsoBmffMetadata(input: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const walk = (start: number, end: number, depth: number) => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = view.getUint32(offset);
      const type = typeAt(bytes, offset + 4);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return;
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) return;

      if (METADATA.has(type) || type.startsWith('©')) {
        // "free" + contenido en cero (se conserva el tamaño).
        bytes.set([0x66, 0x72, 0x65, 0x65], offset + 4);
        bytes.fill(0, offset + header, offset + size);
      } else if (DATED.has(type) && size >= header + 12) {
        const version = bytes[offset + header] ?? 0;
        // versión 0: 4 bytes de creación + 4 de modificación; versión 1: 8 + 8.
        bytes.fill(0, offset + header + 4, offset + header + 4 + (version === 1 ? 16 : 8));
      } else if (CONTAINERS.has(type) && depth < 12) {
        walk(offset + header, offset + size, depth + 1);
      }
      offset += size;
    }
  };

  walk(0, bytes.length, 0);
  return bytes;
}

type Container = 'mp4' | 'mov' | 'webm' | 'ogg';

function detectContainer(bytes: Uint8Array): Container | null {
  if (typeAt(bytes, 4) === 'ftyp') {
    const brand = typeAt(bytes, 8).trim().toLowerCase();
    if (['heic', 'heix', 'mif1', 'msf1', 'avif'].includes(brand)) return null;
    return brand === 'qt' ? 'mov' : 'mp4';
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  if (typeAt(bytes, 0) === 'OggS') return 'ogg';
  return null;
}

/** Duración y tamaño leyendo el archivo con un reproductor del navegador (sin mostrarlo). */
function mediaInfo(blob: Blob, kind: 'video' | 'audio'): Promise<{ w: number | null; h: number | null; dur: number | null }> {
  return new Promise((resolve) => {
    const element = document.createElement(kind);
    const url = URL.createObjectURL(blob);
    const done = (value: { w: number | null; h: number | null; dur: number | null }) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      element.removeAttribute('src');
      resolve(value);
    };
    const timer = setTimeout(() => done({ w: null, h: null, dur: null }), 5000);
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      const seconds = Number.isFinite(element.duration) ? element.duration : null;
      const video = element instanceof HTMLVideoElement ? element : null;
      done({ w: video?.videoWidth || null, h: video?.videoHeight || null, dur: seconds === null ? null : Math.round(seconds * 1000) });
    };
    element.onerror = () => done({ w: null, h: null, dur: null });
    element.src = url;
  });
}

const VIDEO_MIME: Record<Container, string | null> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogg: null };
const AUDIO_MIME: Record<Container, string | null> = { mp4: 'audio/mp4', mov: null, webm: 'audio/webm', ogg: 'audio/ogg' };

export async function sanitizeMedia(source: Blob, kind: 'video' | 'audio', knownDurationMs?: number): Promise<SanitizedFile> {
  if (source.size > UPLOAD_MAX_BYTES[kind]) throw new SanitizeError('El archivo es demasiado grande');
  const original = new Uint8Array(await source.arrayBuffer());
  const container = detectContainer(original);
  const mime = container ? (kind === 'video' ? VIDEO_MIME : AUDIO_MIME)[container] : null;
  if (!container || !mime) throw new SanitizeError(kind === 'video' ? 'Formato de video no compatible (usá MP4, MOV o WebM)' : 'Formato de audio no compatible');
  // WebM y Ogg los genera el propio navegador al grabar: no traen ubicación. MP4/MOV (cámaras, celulares) sí: se limpian.
  const data = container === 'mp4' || container === 'mov' ? stripIsoBmffMetadata(original) : original;
  const info = await mediaInfo(new Blob([new Uint8Array(data)], { type: mime }), kind);
  return { data, meta: { kind, mime, name: null, w: info.w, h: info.h, dur: info.dur ?? knownDurationMs ?? null } };
}

/* ---------- Documentos ---------- */

const ZIP_BASED = new Set(['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'zip']);

export async function sanitizeDocument(file: File): Promise<SanitizedFile> {
  if (file.size > UPLOAD_MAX_BYTES.file) throw new SanitizeError('El documento es demasiado grande');
  const name = file.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(-120);
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (!(ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(extension)) throw new SanitizeError('Tipo de documento no permitido');
  const data = new Uint8Array(await file.arrayBuffer());
  const head = typeAt(data, 0);
  const valid =
    extension === 'pdf'
      ? head === '%PDF'
      : ZIP_BASED.has(extension)
        ? data[0] === 0x50 && data[1] === 0x4b && (data[2] === 0x03 || data[2] === 0x05)
        : isPlainText(data);
  if (!valid) throw new SanitizeError('El contenido del archivo no coincide con su extensión');
  return { data, meta: { kind: 'file', mime: file.type || 'application/octet-stream', name, w: null, h: null, dur: null } };
}

function isPlainText(data: Uint8Array): boolean {
  if (data.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}
