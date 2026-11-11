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
  /** Antivirus ClamAV (clamd). Obligatorio en producción. */
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  /** Rutas a ffmpeg/ffprobe (notas de voz y videos). */
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  RUN_MIGRATIONS: z.enum(['true', 'false']).default('true'),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && !env.CLAMAV_HOST) {
    context.addIssue({ code: 'custom', path: ['CLAMAV_HOST'], message: 'En producción el antivirus (ClamAV) es obligatorio' });
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
