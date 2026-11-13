import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { CallsService } from './calls.service';

/** Cada cuánto se revisan las llamadas que quedaron sonando o abiertas de más. */
const CHECK_INTERVAL_MS = 5_000;

/**
 * Da por "perdidas" las llamadas que sonaron 45 s sin respuesta y corta las que superan la
 * duración máxima. Si la API corre en varias instancias, terminar una llamada es condicional
 * (solo una instancia la termina y avisa).
 */
@Injectable()
export class CallsTimeoutService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CallsTimeoutService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly calls: CallsService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.calls.expire();
    } catch (error) {
      this.logger.error(`Falló la revisión de llamadas: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
