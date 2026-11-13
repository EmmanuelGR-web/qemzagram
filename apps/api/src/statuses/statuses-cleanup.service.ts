import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { StatusesRepository } from '../database/repositories/statuses.repository';
import { BlobStorage } from '../storage/blob-storage.port';

/** Cada cuánto se borran los estados vencidos. */
const PURGE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Limpieza periódica de estados vencidos (filas + archivos cifrados).
 * Es la SEGUNDA protección: las consultas ya ignoran todo lo vencido aunque esto no haya corrido.
 * Si la API corre en varias instancias, borrar dos veces lo mismo es inofensivo.
 */
@Injectable()
export class StatusesCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StatusesCleanupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly statuses: StatusesRepository,
    private readonly storage: BlobStorage,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.purgeExpired(), PURGE_INTERVAL_MS);
    // El temporizador no mantiene vivo el proceso por sí solo.
    this.timer.unref();
    void this.purgeExpired();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Borra todos los estados vencidos, por lotes. Devuelve cuántos borró. */
  async purgeExpired(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let total = 0;
    try {
      for (;;) {
        const { deleted, storageKeys } = await this.statuses.deleteExpired(now);
        total += deleted;
        await Promise.all(
          storageKeys.map((key) =>
            this.storage.delete(key).catch((error: Error) => this.logger.error(`No se pudo borrar el archivo de un estado: ${error.message}`)),
          ),
        );
        if (deleted === 0) break;
      }
      if (total > 0) this.logger.log(`Estados vencidos borrados: ${total}`);
    } catch (error) {
      this.logger.error(`Falló la limpieza de estados: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
    return total;
  }
}
