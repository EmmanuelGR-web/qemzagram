import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { REPORT_EVIDENCE_RETENTION_DAYS } from '@qemzagram/shared';
import { SupportService } from './support.service';

const EVERY_6_HOURS = 6 * 60 * 60 * 1000;

/** Minimización de datos: la evidencia de denuncias resueltas se borra pasado el plazo de retención. */
@Injectable()
export class SupportCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SupportCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly support: SupportService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.run(), EVERY_6_HOURS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<number> {
    try {
      const removed = await this.support.purgeOldEvidence(new Date(now.getTime() - REPORT_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000));
      if (removed > 0) this.logger.log(`Se borraron ${removed} archivos de evidencia vencida`);
      return removed;
    } catch (error) {
      this.logger.error(`Falló la limpieza de evidencia: ${(error as Error).message}`);
      return 0;
    }
  }
}
