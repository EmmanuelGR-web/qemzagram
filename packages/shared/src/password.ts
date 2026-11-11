import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './constants';

export type PasswordIssue =
  | 'length'
  | 'lower'
  | 'upper'
  | 'digit'
  | 'symbol'
  | 'common'
  | 'personal'
  | 'repeat';

export interface PasswordContext {
  tag?: string;
  email?: string;
}

export const PASSWORD_ISSUE_MESSAGES: Record<PasswordIssue, string> = {
  length: `Debe tener entre ${PASSWORD_MIN_LENGTH} y ${PASSWORD_MAX_LENGTH} caracteres`,
  lower: 'Debe incluir una letra minúscula',
  upper: 'Debe incluir una letra mayúscula',
  digit: 'Debe incluir un número',
  symbol: 'Debe incluir un símbolo (por ejemplo ! ? # $ %)',
  common: 'Es demasiado común o predecible',
  personal: 'No puede contener tu tag ni tu correo',
  repeat: 'No puede repetir el mismo carácter más de 3 veces seguidas',
};

/** Fragmentos muy comunes en contraseñas filtradas. Se compara en minúsculas. */
const COMMON_FRAGMENTS: readonly string[] = [
  'password',
  'contrasena',
  'contraseña',
  '123456',
  'qwerty',
  'abcdef',
  'admin',
  'qemzagram',
  'argentina',
  'tucuman',
  'iloveyou',
  'letmein',
  'welcome',
  'boca',
  'river',
  'messi',
];

/**
 * Devuelve la lista de reglas que la contraseña NO cumple.
 * Lista vacía = contraseña aceptada.
 */
export function getPasswordIssues(password: string, context: PasswordContext = {}): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) issues.push('length');
  if (!/\p{Ll}/u.test(password)) issues.push('lower');
  if (!/\p{Lu}/u.test(password)) issues.push('upper');
  if (!/\d/.test(password)) issues.push('digit');
  if (!/[^\p{L}\d]/u.test(password)) issues.push('symbol');

  const lowered = password.toLowerCase();
  if (COMMON_FRAGMENTS.some((fragment) => lowered.includes(fragment))) issues.push('common');

  const emailLocal = context.email?.split('@')[0]?.toLowerCase();
  const personal = [context.tag?.toLowerCase(), emailLocal].filter(
    (value): value is string => typeof value === 'string' && value.length >= 3,
  );
  if (personal.some((value) => lowered.includes(value))) issues.push('personal');

  if (/(.)\1{3,}/u.test(password)) issues.push('repeat');
  return issues;
}

/** Puntaje 0-4 para el medidor visual (no reemplaza a getPasswordIssues). */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length === 0) return 0;
  const issues = getPasswordIssues(password);
  if (issues.length === 0) return password.length >= 16 ? 4 : 3;
  if (issues.length <= 2 && password.length >= 8) return 2;
  return 1;
}
