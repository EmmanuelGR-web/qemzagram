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
