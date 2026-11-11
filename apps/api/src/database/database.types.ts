import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

export const DB = Symbol('DB');
export const DB_HANDLE = Symbol('DB_HANDLE');

/** Tipo común a PostgreSQL real (pg) y PGlite (desarrollo/tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

/** Detecta violación de restricción UNIQUE (código 23505) sin importar el driver. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
