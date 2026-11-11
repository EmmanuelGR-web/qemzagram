export type ScanResult = { clean: true } | { clean: false; signature: string };

/**
 * Puerto de análisis antivirus. Toda subida pasa por acá ANTES de guardarse.
 * Si el antivirus no responde, la subida se rechaza ("fallar cerrado"): nunca se guarda sin analizar.
 */
export abstract class AntivirusPort {
  abstract scan(data: Buffer): Promise<ScanResult>;
}

export class AntivirusUnavailableError extends Error {
  constructor(cause: string) {
    super(`Antivirus no disponible: ${cause}`);
    this.name = 'AntivirusUnavailableError';
  }
}
