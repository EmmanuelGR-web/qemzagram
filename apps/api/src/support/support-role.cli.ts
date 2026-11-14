/**
 * Comando de consola para dar o quitar el rol de soporte. NO existe ninguna ruta HTTP que cambie roles:
 * hace falta acceso al servidor y a su base de datos. Uso (desde la raíz del repo):
 *
 *   npm run support:grant -- @tag
 *   npm run support:revoke -- @tag
 *   npm run support:list
 *
 * En modo `setup:sin-docker` (PGlite) frená la API antes: la base embebida admite un solo proceso.
 */
import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync } from 'node:fs';
import { AuditService } from '../common/audit.service';
import { CommonModule } from '../common/common.module';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { UsersRepository } from '../database/repositories/users.repository';

@Module({ imports: [ConfigModule, DatabaseModule, CommonModule] })
class SupportCliModule {}

type Command = 'grant' | 'revoke' | 'list';

export async function runSupportCommand(users: UsersRepository, audit: AuditService, command: Command, rawTag?: string): Promise<string> {
  if (command === 'list') {
    const team = await users.listByRole('support');
    return team.length === 0 ? 'No hay cuentas de soporte.' : team.map((user) => `@${user.tag} (${user.status})`).join('\n');
  }
  const tag = (rawTag ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!tag) throw new Error('Indicá el tag: npm run support:grant -- @tag');
  const user = await users.findByTag(tag);
  if (!user || user.status === 'deleted') throw new Error(`No existe la cuenta @${tag}`);
  if (command === 'grant' && user.status !== 'active') throw new Error(`La cuenta @${tag} no está activa (${user.status})`);
  const role = command === 'grant' ? 'support' : 'user';
  await users.setRole(user.id, role);
  await audit.log(command === 'grant' ? 'support.role_granted' : 'support.role_revoked', { userId: user.id, meta: { via: 'cli' } });
  return command === 'grant' ? `@${tag} ahora tiene el rol de soporte.` : `@${tag} ya no tiene el rol de soporte.`;
}

async function main(): Promise<void> {
  const [command, tag] = process.argv.slice(2);
  if (command !== 'grant' && command !== 'revoke' && command !== 'list') {
    throw new Error('Uso: support-role.cli <grant|revoke|list> [@tag]');
  }
  if (existsSync('.env')) process.loadEnvFile('.env');
  const app = await NestFactory.createApplicationContext(SupportCliModule, { logger: ['error', 'warn'] });
  try {
    console.log(await runSupportCommand(app.get(UsersRepository), app.get(AuditService), command, tag));
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    new Logger('support').error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
