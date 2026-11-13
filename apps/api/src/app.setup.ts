import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { text } from 'express';
import helmet from 'helmet';
import type { AppEnv } from './config/env';
import { SecureIoAdapter } from './realtime/secure-io.adapter';
import { StorageService } from './storage/storage.service';

/** Configuración de seguridad HTTP común a producción y tests. */
export function configureApp(app: NestExpressApplication, env: AppEnv): void {
  app.set('trust proxy', 1); // detrás de un proxy (Render, Nginx) la IP real viene en X-Forwarded-For
  app.disable('x-powered-by');

  app.use(
    helmet({
      // La API solo devuelve JSON/imágenes: se prohíbe cargar cualquier recurso activo.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // la web (otro origen) muestra las fotos
      referrerPolicy: { policy: 'no-referrer' },
      hsts: { maxAge: 31_536_000, includeSubDomains: true },
    }),
  );
  app.use(cookieParser());
  // Avisos del servidor de llamadas: se leen como TEXTO crudo para verificar el hash de su firma.
  app.use('/calls/livekit-webhook', text({ type: 'application/webhook+json', limit: '64kb' }));
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
  });

  const storage = app.get(StorageService);
  app.useStaticAssets(storage.directory, {
    prefix: '/uploads/',
    index: false,
    dotfiles: 'deny',
    maxAge: '7d',
    immutable: true,
    setHeaders: (response) => response.setHeader('X-Content-Type-Options', 'nosniff'),
  });

  app.useWebSocketAdapter(new SecureIoAdapter(app, env.WEB_ORIGIN));
  app.enableShutdownHooks();
}
