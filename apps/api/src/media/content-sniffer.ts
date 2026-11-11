/**
 * Detección del tipo REAL de un archivo por sus primeros bytes ("números mágicos").
 * Nunca se confía en la extensión ni en el Content-Type que envía el cliente.
 *
 * Es una lista CERRADA: si el contenido no coincide con ningún formato conocido, se rechaza.
 */

export type SniffedFamily = 'image' | 'audio-video' | 'document' | 'text';

export interface SniffedType {
  family: SniffedFamily;
  /** Formato detectado (p. ej. "jpeg", "mp4", "pdf", "zip"). */
  format: string;
}

const startsWith = (buffer: Buffer, bytes: number[], offset = 0): boolean =>
  buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte);

const ascii = (buffer: Buffer, start: number, end: number): string => buffer.subarray(start, end).toString('latin1');

/** Marcas ("brands") ISO-BMFF de imágenes HEIF/AVIF; el resto de "ftyp" son audio/video (MP4, MOV, M4A, 3GP). */
const IMAGE_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);

export function sniff(buffer: Buffer): SniffedType | null {
  if (buffer.length < 4) return buffer.length > 0 ? sniffText(buffer) : null;

  // ---- imágenes ----
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return { family: 'image', format: 'jpeg' };
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { family: 'image', format: 'png' };
  if (ascii(buffer, 0, 6) === 'GIF87a' || ascii(buffer, 0, 6) === 'GIF89a') return { family: 'image', format: 'gif' };
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return { family: 'image', format: 'webp' };

  // ---- contenedores ISO-BMFF (MP4/MOV/M4A/3GP o HEIF/AVIF) ----
  if (ascii(buffer, 4, 8) === 'ftyp') {
    const brand = ascii(buffer, 8, 12).trim().toLowerCase();
    return IMAGE_BRANDS.has(brand) ? { family: 'image', format: 'heif' } : { family: 'audio-video', format: 'mp4' };
  }

  // ---- audio / video ----
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return { family: 'audio-video', format: 'webm' }; // WebM / Matroska
  if (ascii(buffer, 0, 4) === 'OggS') return { family: 'audio-video', format: 'ogg' };
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WAVE') return { family: 'audio-video', format: 'wav' };
  if (ascii(buffer, 0, 3) === 'ID3') return { family: 'audio-video', format: 'mp3' };
  if (buffer[0] === 0xff && buffer[1] !== undefined && (buffer[1] & 0xf6) === 0xf0) return { family: 'audio-video', format: 'aac' }; // ADTS
  if (buffer[0] === 0xff && buffer[1] !== undefined && (buffer[1] & 0xe0) === 0xe0) return { family: 'audio-video', format: 'mp3' }; // MPEG frame sync

  // ---- documentos ----
  if (ascii(buffer, 0, 5) === '%PDF-') return { family: 'document', format: 'pdf' };
  // ZIP (y formatos basados en ZIP: docx, xlsx, pptx, odt, ods, odp).
  if (startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWith(buffer, [0x50, 0x4b, 0x05, 0x06])) {
    return { family: 'document', format: 'zip' };
  }

  return sniffText(buffer);
}

/** Texto plano: UTF-8 válido y sin bytes nulos ni caracteres de control raros. */
function sniffText(buffer: Buffer): SniffedType | null {
  const sample = buffer.subarray(0, 64 * 1024);
  if (sample.includes(0)) return null;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(sample.length < buffer.length ? trimPartialUtf8(sample) : sample);
    // Caracteres de control distintos de tab, salto de línea y retorno de carro: no es texto.
    if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
    return { family: 'text', format: 'text' };
  } catch {
    return null;
  }
}

/** Si la muestra cortó un carácter UTF-8 a la mitad, se descartan esos bytes finales. */
function trimPartialUtf8(sample: Buffer): Buffer {
  let end = sample.length;
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const byte = sample[end - back];
    if (byte === undefined) break;
    if ((byte & 0xc0) === 0xc0) return sample.subarray(0, end - back); // inicio de un carácter multibyte incompleto
    if ((byte & 0x80) === 0) break;
  }
  return sample;
}
