import { Logger } from '@nestjs/common';
import { createConnection } from 'node:net';
import { AntivirusPort, AntivirusUnavailableError, type ScanResult } from './antivirus.port';

const CHUNK_SIZE = 64 * 1024;
const TIMEOUT_MS = 30_000;

/**
 * Cliente de ClamAV (demonio `clamd`) usando el protocolo INSTREAM por TCP.
 * No necesita dependencias: se manda el archivo en bloques [largo de 4 bytes][datos] y un bloque vacío al final.
 * Respuestas posibles: "stream: OK" o "stream: <firma> FOUND".
 */
export class ClamAvScanner extends AntivirusPort {
  private readonly logger = new Logger(ClamAvScanner.name);

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {
    super();
  }

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise<ScanResult>((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;
      const finish = (error: Error | null, result?: ScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) {
          this.logger.error(error.message);
          reject(new AntivirusUnavailableError(error.message));
        } else if (result) {
          resolve(result);
        }
      };

      socket.setTimeout(TIMEOUT_MS, () => finish(new Error('tiempo de espera agotado')));
      socket.on('error', (error) => finish(error));
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.on('end', () => {
        const reply = Buffer.concat(chunks).toString('utf8').replace(/\0/g, '').trim();
        if (/^stream: OK$/.test(reply)) return finish(null, { clean: true });
        const found = /^stream: (.+) FOUND$/.exec(reply);
        if (found?.[1]) return finish(null, { clean: false, signature: found[1] });
        finish(new Error(`respuesta inesperada de clamd: ${reply.slice(0, 120)}`));
      });

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
          const chunk = data.subarray(offset, offset + CHUNK_SIZE);
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length, 0);
          socket.write(size);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4)); // bloque de largo 0 = fin del archivo
      });
    });
  }
}
