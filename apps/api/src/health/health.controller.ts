import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../common/decorators';
import { DB, type Database } from '../database/database.types';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ code: 'DB_DOWN', message: 'Base de datos no disponible' });
    }
  }
}
