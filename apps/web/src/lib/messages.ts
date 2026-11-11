import { GENERAL_STICKER_LABELS, type MessageDto, type UploadKind } from '@qemzagram/shared';

/** Texto corto para la lista de chats (último mensaje). */
export function messagePreview(message: MessageDto): string {
  if (message.sticker) return `Sticker · ${GENERAL_STICKER_LABELS[message.sticker]}`;
  const caption = message.body.trim();
  switch (message.attachment?.kind) {
    case 'image':
      return caption ? `📷 ${caption}` : '📷 Foto';
    case 'video':
      return caption ? `🎬 ${caption}` : '🎬 Video';
    case 'audio':
      return `🎤 Nota de voz (${formatDuration(message.attachment.durationMs)})`;
    case 'file':
      return `📎 ${message.attachment.name ?? 'Archivo'}`;
    case 'sticker':
      return 'Sticker';
    default:
      return caption;
  }
}

/**
 * Elige el tipo de adjunto según el archivo elegido. Es solo una sugerencia de la interfaz:
 * el servidor vuelve a validar el CONTENIDO real y rechaza lo que no coincida.
 */
export function kindForFile(file: File): UploadKind {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
