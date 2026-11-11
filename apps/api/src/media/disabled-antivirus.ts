import { Logger } from '@nestjs/common';
import { AntivirusPort, type ScanResult } from './antivirus.port';

/**
 * Antivirus DESACTIVADO: solo para desarrollo local sin ClamAV.
 * La configuración (`env.ts`) impide usarlo en producción: allí CLAMAV_HOST es obligatorio.
 */
export class DisabledAntivirus extends AntivirusPort {
  constructor() {
    super();
    new Logger('Antivirus').warn('ClamAV no configurado (CLAMAV_HOST vacío): los archivos NO se analizan. Solo aceptable en desarrollo.');
  }

  async scan(): Promise<ScanResult> {
    return { clean: true };
  }
}
