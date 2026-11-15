import { z } from 'zod';

export const ENV = Symbol('ENV');

const base64Key = (bytes: number) =>
  z.string().refine((value) => Buffer.from(value, 'base64').length === bytes, {
    message: `Debe ser una clave en base64 de ${bytes} bytes`,
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** postgres://... o pglite://memory | pglite://./carpeta (solo desarrollo y tests) */
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(32, 'Mínimo 32 caracteres'),
  JWT_TICKET_SECRET: z.string().min(32, 'Mínimo 32 caracteres'),
  PASSWORD_PEPPER: z.string().min(16, 'Mínimo 16 caracteres'),
  MESSAGE_ENC_KEY: base64Key(32),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  MAIL_FROM: z.string().default('Qemzagram <no-reply@qemzagram.local>'),
  UPLOAD_DIR: z.string().default('./uploads'),
  /** Adjuntos de los chats y stickers propios: cifrados y FUERA de la carpeta pública. */
  MEDIA_DIR: z.string().default('./media'),
  /**
   * Dónde se guardan los adjuntos cifrados: `local` (carpeta MEDIA_DIR) o `s3` (Backblaze B2, Cloudflare R2,
   * MinIO, AWS…). El bucket S3 tiene que ser PRIVADO: los archivos se sirven solo por la API.
   */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  /** Dirección del servicio S3, por ejemplo https://s3.us-east-005.backblazeb2.com */
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Región inválida').default('us-east-1'),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'Nombre de bucket inválido').optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  /** Carpeta dentro del bucket (termina en "/"). */
  S3_PREFIX: z.string().regex(/^([a-z0-9_-]+\/)*$/, 'Usá algo como media/').default('media/'),
  /** true = https://servidor/bucket/clave (B2, MinIO). false = https://bucket.servidor/clave. */
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  /** Antivirus ClamAV (clamd). Obligatorio en producción. */
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  /** Rutas a ffmpeg/ffprobe (notas de voz y videos). */
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  RUN_MIGRATIONS: z.enum(['true', 'false']).default('true'),
  /** Servidor de llamadas LiveKit: dirección que usa el NAVEGADOR (ws:// en desarrollo, wss:// en producción). */
  LIVEKIT_URL: z.string().url().default('ws://localhost:7880'),
  /** Dirección que usa la API para hablar con LiveKit (si se omite, se deriva de LIVEKIT_URL). */
  LIVEKIT_API_URL: z.string().url().optional(),
  /** Credenciales de LiveKit. Vacías = llamadas deshabilitadas. */
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  /** Notificaciones push (Web Push). Generalas con: npx web-push generate-vapid-keys. Vacías = sin push. */
  VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/, 'Clave VAPID pública inválida').optional(),
  VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{40,50}$/, 'Clave VAPID privada inválida').optional(),
  /** Contacto para los servicios de push (mailto: o https:). */
  /** Redis compartido (redis:// o rediss://) para límites de peticiones y desafíos anti-bots entre varias instancias. */
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'Usá redis:// o rediss://').optional(),
  /** Prueba de trabajo anti-bots en registro, login, recuperación y apelación. Obligatoria en producción. */
  POW_ENABLED: z.enum(['true', 'false']).default('true'),
  /** Bits en cero exigidos (cada +1 duplica el trabajo). 16 ≈ 65.000 intentos ≈ 1 s en un celular. */
  POW_DIFFICULTY: z.coerce.number().int().min(0).max(24).default(16),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, 'Usá mailto:correo o https://sitio').default('mailto:soporte@qemzagram.local'),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && (env.POW_ENABLED !== 'true' || env.POW_DIFFICULTY < 12)) {
    context.addIssue({ code: 'custom', path: ['POW_ENABLED'], message: 'En producción la prueba anti-bots es obligatoria (POW_ENABLED=true y POW_DIFFICULTY >= 12)' });
  }
  if (Boolean(env.VAPID_PUBLIC_KEY) !== Boolean(env.VAPID_PRIVATE_KEY)) {
    context.addIssue({ code: 'custom', path: ['VAPID_PRIVATE_KEY'], message: 'VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY van juntas' });
  }
  if (env.NODE_ENV === 'production' && !env.CLAMAV_HOST) {
    context.addIssue({ code: 'custom', path: ['CLAMAV_HOST'], message: 'En producción el antivirus (ClamAV) es obligatorio' });
  }
  if (env.STORAGE_DRIVER === 's3') {
    for (const name of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!env[name]) context.addIssue({ code: 'custom', path: [name], message: 'Obligatoria con STORAGE_DRIVER=s3' });
    }
    if (env.NODE_ENV === 'production' && env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith('https://')) {
      context.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'En producción el almacenamiento S3 tiene que usar https://' });
    }
  }
  if (Boolean(env.LIVEKIT_API_KEY) !== Boolean(env.LIVEKIT_API_SECRET)) {
    context.addIssue({ code: 'custom', path: ['LIVEKIT_API_SECRET'], message: 'LIVEKIT_API_KEY y LIVEKIT_API_SECRET van juntos' });
  }
  if (env.NODE_ENV === 'production' && env.LIVEKIT_API_SECRET !== undefined) {
    if (env.LIVEKIT_API_SECRET.length < 32 || env.LIVEKIT_API_KEY === 'devkey') {
      context.addIssue({ code: 'custom', path: ['LIVEKIT_API_SECRET'], message: 'En producción usá credenciales de LiveKit propias (secreto de 32+ caracteres)' });
    }
    if (!env.LIVEKIT_URL.startsWith('wss://')) {
      context.addIssue({ code: 'custom', path: ['LIVEKIT_URL'], message: 'En producción LiveKit tiene que usar wss://' });
    }
  }
});

export type AppEnv = z.infer<typeof envSchema>;

/** Valida las variables de entorno al arrancar: si falta algo, la app NO inicia. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Configuración inválida. Revisá tu archivo .env:\n${detail}`);
  }
  return result.data;
}
