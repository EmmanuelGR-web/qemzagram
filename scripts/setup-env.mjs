#!/usr/bin/env node
// Crea apps/api/.env con secretos aleatorios a partir de apps/api/.env.example.
// Uso (desde la raíz):  npm run setup        |   Opción:  npm run setup -- --pglite   (sin Docker)
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const example = join(root, 'apps', 'api', '.env.example');
const target = join(root, 'apps', 'api', '.env');

if (existsSync(target)) {
  console.log('✔ apps/api/.env ya existe: no se modifica (para regenerarlo, borralo primero).');
  process.exit(0);
}

const usePglite = process.argv.includes('--pglite');
const secrets = {
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  JWT_TICKET_SECRET: randomBytes(32).toString('hex'),
  PASSWORD_PEPPER: randomBytes(24).toString('hex'),
  MESSAGE_ENC_KEY: randomBytes(32).toString('base64'),
};

let content = readFileSync(example, 'utf8');
for (const [key, value] of Object.entries(secrets)) {
  content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
}
if (usePglite) {
  content = content
    .replace(/^DATABASE_URL=postgres.*$/m, 'DATABASE_URL=pglite://./.data/dev')
    .replace(/^SMTP_HOST=.*$/m, 'SMTP_HOST='); // sin SMTP: los enlaces salen por consola
}

writeFileSync(target, content, { mode: 0o600 });
console.log('✔ Creado apps/api/.env con secretos aleatorios.');
console.log(usePglite ? '  Modo sin Docker (PGlite): los correos se imprimen en la consola de la API.' : '  Siguiente paso: npm run db:up');
console.log('  ⚠ Guardá una copia segura de PASSWORD_PEPPER y MESSAGE_ENC_KEY: si se pierden, no se recuperan datos.');
