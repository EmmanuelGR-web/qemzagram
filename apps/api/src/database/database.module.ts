import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ENV, type AppEnv } from '../config/env';
import { DB, DB_HANDLE, type Database, type DatabaseHandle } from './database.types';
import { BlocksRepository } from './repositories/blocks.repository';
import { GreetingsRepository } from './repositories/greetings.repository';
import { ReportsRepository } from './repositories/reports.repository';
import { AppealsRepository } from './repositories/appeals.repository';
import { MfaRepository } from './repositories/mfa.repository';
import { PasskeysRepository } from './repositories/passkeys.repository';
import { SupportStatsRepository } from './repositories/support-stats.repository';
import { NearbyRepository } from './repositories/nearby.repository';
import { AttachmentsRepository } from './repositories/attachments.repository';
import { CallsRepository } from './repositories/calls.repository';
import { ContactsRepository } from './repositories/contacts.repository';
import { ConversationsRepository } from './repositories/conversations.repository';
import { EmailTokensRepository } from './repositories/email-tokens.repository';
import { PushSubscriptionsRepository } from './repositories/push-subscriptions.repository';
import { StatusesRepository } from './repositories/statuses.repository';
import { StickersRepository } from './repositories/stickers.repository';
import { SessionsRepository } from './repositories/sessions.repository';
import { UsersRepository } from './repositories/users.repository';
import * as schema from './schema';

const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');

async function createHandle(env: AppEnv): Promise<DatabaseHandle> {
  const logger = new Logger('Database');

  if (env.DATABASE_URL.startsWith('pglite://')) {
    // PGlite: PostgreSQL embebido. Solo para desarrollo rápido y tests (NO usar en producción).
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const location = env.DATABASE_URL.slice('pglite://'.length);
    // PGlite no crea carpetas anidadas por sí mismo: se aseguran antes de abrir la base.
    if (location !== 'memory') mkdirSync(location, { recursive: true });
    const client = new PGlite(location === 'memory' ? undefined : location);
    const db = drizzle(client, { schema });
    if (env.RUN_MIGRATIONS === 'true') await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    logger.warn('Usando PGlite (base embebida). Para producción usá PostgreSQL real.');
    return { db: db as unknown as Database, close: () => client.close() };
  }

  const { Pool } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  pool.on('error', (error) => logger.error(`Error en el pool de PostgreSQL: ${error.message}`));
  const db = drizzle(pool, { schema });
  if (env.RUN_MIGRATIONS === 'true') await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db: db as unknown as Database, close: () => pool.end() };
}

@Global()
@Module({
  providers: [
    { provide: DB_HANDLE, inject: [ENV], useFactory: createHandle },
    { provide: DB, inject: [DB_HANDLE], useFactory: (handle: DatabaseHandle) => handle.db },
    UsersRepository,
    SessionsRepository,
    EmailTokensRepository,
    ContactsRepository,
    ConversationsRepository,
    AttachmentsRepository,
    StickersRepository,
    StatusesRepository,
    CallsRepository,
    PushSubscriptionsRepository,
    BlocksRepository,
    NearbyRepository,
    GreetingsRepository,
    ReportsRepository,
    AppealsRepository,
    MfaRepository,
    PasskeysRepository,
    SupportStatsRepository,
  ],
  exports: [
    DB,
    UsersRepository,
    SessionsRepository,
    EmailTokensRepository,
    ContactsRepository,
    ConversationsRepository,
    AttachmentsRepository,
    StickersRepository,
    StatusesRepository,
    CallsRepository,
    PushSubscriptionsRepository,
    BlocksRepository,
    NearbyRepository,
    GreetingsRepository,
    ReportsRepository,
    AppealsRepository,
    MfaRepository,
    PasskeysRepository,
    SupportStatsRepository,
  ],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
