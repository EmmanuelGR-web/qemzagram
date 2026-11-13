import { STATUS_BACKGROUNDS, type StatusBackground, type StatusDto } from '@qemzagram/shared';

/** Nombre visible de cada fondo (el CSS de cada uno está en globals.css: `.status-bg[data-bg=…]`). */
export const STATUS_BACKGROUND_LABELS: Record<StatusBackground, string> = {
  rojo: 'Rojo',
  vino: 'Vino',
  coral: 'Coral',
  noche: 'Noche',
  rosa: 'Rosa',
};
export const STATUS_BACKGROUND_OPTIONS = STATUS_BACKGROUNDS.map((value) => ({ value, label: STATUS_BACKGROUND_LABELS[value] }));

/** Cuánto dura en pantalla un estado de texto o foto (los videos duran lo que dura el video). */
export const STATUS_DISPLAY_MS = 6000;

/** "hace 5 min", "hace 3 h", "recién". */
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.floor(minutes / 60)} h`;
}

/** Texto corto para la lista ("📷 Foto", "🎬 Video" o el comienzo del texto). */
export function statusPreview(status: StatusDto): string {
  const text = status.body.trim();
  if (status.kind === 'image') return text ? `📷 ${text}` : '📷 Foto';
  if (status.kind === 'video') return text ? `🎬 ${text}` : '🎬 Video';
  return text;
}
