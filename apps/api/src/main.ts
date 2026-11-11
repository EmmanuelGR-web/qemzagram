import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const env = loadEnv(); // si falta una variable obligatoria, se detiene acá con un mensaje claro

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  configureApp(app, env);
  await app.listen(env.PORT);
  new Logger('Qemzagram').log(`API lista en http://localhost:${env.PORT}  (entorno: ${env.NODE_ENV})`);
}

bootstrap().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
