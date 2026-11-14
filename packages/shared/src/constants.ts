/** Reglas de negocio compartidas entre la API y la Web. */

export const TAG_MIN_LENGTH = 3;
export const TAG_MAX_LENGTH = 20;
/** Letras minúsculas, números, punto y guion bajo. Empieza y termina con letra o número. */
export const TAG_REGEX = /^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/;

export const RESERVED_TAGS: readonly string[] = [
  'admin',
  'administrador',
  'soporte',
  'support',
  'ayuda',
  'help',
  'qemzagram',
  'qemza',
  'neoematech',
  'root',
  'system',
  'sistema',
  'moderador',
  'security',
  'seguridad',
];

export const DISPLAY_NAME_MAX_LENGTH = 40;
export const BIO_MAX_LENGTH = 160;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Un grupo admite hasta 10 miembros en total (incluye a quien lo crea). */
export const GROUP_MAX_MEMBERS = 10;
export const GROUP_TITLE_MAX_LENGTH = 50;

export const MESSAGE_MAX_LENGTH = 4000;
export const CONTACTS_MAX = 500;

/* ---------- Fase 5: bloqueos ---------- */
export const BLOCKS_MAX = 1000;

/* ---------- Fase 2: multimedia ---------- */

/** Tipos de adjunto de un mensaje. */
export const ATTACHMENT_KINDS = ['image', 'file', 'audio', 'video', 'sticker'] as const;
/** Los que se suben como archivo (los stickers se envían desde el selector). */
export const UPLOAD_KINDS = ['image', 'file', 'audio', 'video'] as const;

const MB = 1024 * 1024;
/** Tamaño máximo del archivo ORIGINAL que se sube, por tipo. */
export const UPLOAD_MAX_BYTES: Record<(typeof UPLOAD_KINDS)[number], number> = {
  image: 10 * MB,
  file: 25 * MB,
  audio: 10 * MB,
  video: 50 * MB,
};
export const UPLOAD_MAX_BYTES_ANY = 50 * MB;

/** Duración máxima de una nota de voz y de un video (segundos). */
export const VOICE_MAX_SECONDS = 300;
export const VIDEO_MAX_SECONDS = 180;

/** Extensiones de documentos permitidas (lista cerrada; sin formatos con macros ni ejecutables). */
export const ALLOWED_FILE_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'zip', 'txt', 'csv'] as const;
export const FILE_NAME_MAX_LENGTH = 120;

/** Stickers propios: imagen de hasta 5 MB que se convierte a WebP 512×512. */
export const STICKER_UPLOAD_MAX_BYTES = 5 * MB;
export const STICKER_SIZE = 512;
export const CUSTOM_STICKERS_MAX = 60;

/** Pack general de stickers incluido en la app (las imágenes viven en la web: /stickers/<código>.svg). */
export const GENERAL_STICKER_CODES = ['hola', 'gracias', 'jaja', 'corazon', 'genial', 'ok', 'triste', 'sorpresa', 'fiesta', 'mate', 'abrazo', 'chau'] as const;
export type GeneralStickerCode = (typeof GENERAL_STICKER_CODES)[number];
export const GENERAL_STICKER_LABELS: Record<GeneralStickerCode, string> = {
  hola: '¡Hola!',
  gracias: 'Gracias',
  jaja: 'Jaja',
  corazon: 'Te quiero',
  genial: 'Genial',
  ok: 'Dale',
  triste: 'Triste',
  sorpresa: '¡Wow!',
  fiesta: 'Fiesta',
  mate: '¿Unos mates?',
  abrazo: 'Abrazo',
  chau: 'Chau',
};

/* ---------- Fase 3: estados (24 horas) ---------- */

/** Un estado dura 24 horas desde que se publica. */
export const STATUS_TTL_HOURS = 24;
export const STATUS_TEXT_MAX_LENGTH = 700;
/** Máximo de estados vigentes por persona (evita abusos de almacenamiento). */
export const STATUS_ACTIVE_MAX = 30;
/** Un video de estado dura como máximo 60 segundos. */
export const STATUS_VIDEO_MAX_SECONDS = 60;
/** Tipos de estado. */
export const STATUS_KINDS = ['text', 'image', 'video'] as const;
/** Los que se suben como archivo. */
export const STATUS_MEDIA_KINDS = ['image', 'video'] as const;
/** Fondos de los estados de texto (lista cerrada: el cliente no puede mandar CSS arbitrario). */
export const STATUS_BACKGROUNDS = ['rojo', 'vino', 'coral', 'noche', 'rosa'] as const;
export type StatusBackground = (typeof STATUS_BACKGROUNDS)[number];

/** Quién puede ver mis estados: toda mi agenda, mi agenda menos algunas personas, o solo algunas personas. */
export const STATUS_AUDIENCES = ['contacts', 'except', 'only'] as const;
export type StatusAudience = (typeof STATUS_AUDIENCES)[number];

/* ---------- Fase 4: llamadas y videollamadas ---------- */

export const CALL_KINDS = ['audio', 'video'] as const;
export const CALL_STATUSES = ['ringing', 'active', 'ended'] as const;
/** Por qué terminó: atendida y cortada, nadie atendió, la rechazaron, quien llamaba cortó antes, o falló. */
export const CALL_END_REASONS = ['completed', 'missed', 'declined', 'cancelled', 'failed'] as const;
export const CALL_PARTICIPANT_STATES = ['invited', 'joined', 'left', 'declined'] as const;
/** Segundos que suena una llamada antes de darse por perdida. */
export const CALL_RING_SECONDS = 45;
/** Duración máxima de una llamada (horas): después se corta sola. */
export const CALL_MAX_HOURS = 4;
