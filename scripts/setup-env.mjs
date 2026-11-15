#!/usr/bin/env node
// Crea apps/api/.env con secretos aleatorios a partir de apps/api/.env.example.
// Uso (desde la raíz):  npm run setup        |   Opción:  npm run setup -- --pglite   (sin Docker)
// Producción:  node scripts/setup-env.mjs --produccion   → crea deploy/.env (ver docs/DESPLIEGUE.md)
// Solo usa módulos de Node: se puede correr en el servidor dentro de un contenedor, sin npm install.
import { createECDH, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--produccion');
const folder = production ? join(root, 'deploy') : join(root, 'apps', 'api');
const label = production ? 'deploy/.env' : 'apps/api/.env';
const example = join(folder, '.env.example');
const target = join(folder, '.env');

if (existsSync(target)) {
  console.log(`✔ ${label} ya existe: no se modifica (para regenerarlo, borralo primero).`);
  process.exit(0);
}

const usePglite = process.argv.includes('--pglite');
const secrets = {
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
  JWT_TICKET_SECRET: randomBytes(32).toString('hex'),
  PASSWORD_PEPPER: randomBytes(24).toString('hex'),
  MESSAGE_ENC_KEY: randomBytes(32).toString('base64'),
  ...vapidKeys(),
};
if (production) {
  Object.assign(secrets, {
    POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
    LIVEKIT_API_KEY: `qz${randomBytes(8).toString('hex')}`,
    LIVEKIT_API_SECRET: randomBytes(32).toString('hex'),
  });
}

/** Claves VAPID (Web Push): un par P-256 en base64url, igual que `npx web-push generate-vapid-keys`. */
function vapidKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const privateKey = Buffer.alloc(32);
  const raw = ecdh.getPrivateKey();
  raw.copy(privateKey, 32 - raw.length); // con ceros a la izquierda si hiciera falta
  return { VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'), VAPID_PRIVATE_KEY: privateKey.toString('base64url') };
}

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
console.log(`✔ Creado ${label} con secretos aleatorios.`);
if (production) console.log('  Siguiente paso: completá DOMAIN, ACME_EMAIL, SMTP_* y S3_* (marcados con ← COMPLETAR).');
else console.log(usePglite ? '  Modo sin Docker (PGlite): los correos se imprimen en la consola de la API.' : '  Siguiente paso: npm run db:up');
console.log('  ⚠ Guardá una copia segura de PASSWORD_PEPPER y MESSAGE_ENC_KEY: si se pierden, no se recuperan datos.');
