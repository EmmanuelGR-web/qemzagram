import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { NearbyService } from './nearby.service';

const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Cada 5 minutos borra la celda de quienes ya vencieron (la visibilidad dura 1 hora).
 * Es la SEGUNDA protección: las búsquedas ya ignoran a los vencidos aunque esto no haya corrido.
 */
@Injectable()
export class NearbyCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NearbyCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly nearby: NearbyService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), INTERVAL_MS);
    this.timer.unref();
    void this.run();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    try {
      await this.nearby.hideExpired();
    } catch (error) {
      this.logger.error(`Falló la limpieza de ubicaciones vencidas: ${(error as Error).message}`);
    }
  }
}
