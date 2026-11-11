import { Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { MediaRejectedError, MediaTranscoder, type TranscodeResult, type TranscodeTarget } from './transcoder.port';

const TIMEOUT_MS = 180_000;
const MAX_CONCURRENT = 2;
const MAX_OUTPUT_BYTES = 80 * 1024 * 1024;

/** Lo que nos interesa de la salida JSON de ffprobe (validado: es un proceso externo). */
const probeSchema = z.object({
  streams: z.array(z.object({ codec_type: z.string(), width: z.number().optional(), height: z.number().optional() })).default([]),
  format: z.object({ duration: z.string().optional() }).default({}),
});
type Probe = z.infer<typeof probeSchema>;

/** Opciones comunes: sin entrada por teclado, solo archivos locales (nada de red ni "concat:"). */
const SAFE_INPUT = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file'];
/** Quita TODOS los metadatos (globales, por pista y capítulos): título, autor, GPS, dispositivo… */
const STRIP_METADATA = ['-map_metadata', '-1', '-map_metadata:s:v', '-1', '-map_metadata:s:a', '-1', '-map_chapters', '-1', '-fflags', '+bitexact'];

const ARGS: Record<TranscodeTarget, { output: string; mimeType: string; args: string[] }> = {
  voice: {
    output: 'out.m4a',
    mimeType: 'audio/mp4',
    args: ['-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '44100', '-movflags', '+faststart', '-f', 'mp4'],
  },
  video: {
    output: 'out.mp4',
    mimeType: 'video/mp4',
    args: [
      '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
      // Máximo 1280 px por lado, dimensiones pares y formato compatible con todos los navegadores.
      '-vf', "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
      '-movflags', '+faststart', '-f', 'mp4',
    ],
  },
};

/**
 * Implementación con ffmpeg/ffprobe instalados en el sistema.
 * Se ejecutan SIN shell (los argumentos van como lista: no hay inyección de comandos posible),
 * con tiempo máximo, con un límite de procesos simultáneos y en una carpeta temporal que se borra siempre.
 */
export class FfmpegTranscoder extends MediaTranscoder {
  private readonly logger = new Logger(FfmpegTranscoder.name);
  private available?: Promise<boolean>;
  private running = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly ffmpegPath: string,
    private readonly ffprobePath: string,
  ) {
    super();
  }

  isAvailable(): Promise<boolean> {
    this.available ??= Promise.all([this.run(this.ffmpegPath, ['-version']), this.run(this.ffprobePath, ['-version'])])
      .then(() => true)
      .catch(() => {
        this.logger.warn('ffmpeg/ffprobe no encontrados: las notas de voz y los videos quedan deshabilitados. Ver FFMPEG_PATH en .env');
        return false;
      });
    return this.available;
  }

  async transcode(input: Buffer, target: TranscodeTarget, maxSeconds: number): Promise<TranscodeResult> {
    await this.acquire();
    const dir = await mkdtemp(join(tmpdir(), 'qz-ffmpeg-'));
    try {
      const inputPath = join(dir, 'input');
      await writeFile(inputPath, input, { mode: 0o600 });

      const source = await this.probe(inputPath);
      const needed = target === 'voice' ? 'audio' : 'video';
      if (!source.streams.some((stream) => stream.codec_type === needed)) {
        throw new MediaRejectedError('INVALID_MEDIA', target === 'voice' ? 'El archivo no contiene audio' : 'El archivo no contiene video');
      }

      const spec = ARGS[target];
      const outputPath = join(dir, spec.output);
      // Se corta en el máximo + 1 s: si el resultado dura más que el máximo, se rechaza.
      // (Los audios grabados en el navegador muchas veces no traen la duración en la cabecera.)
      await this.run(this.ffmpegPath, [...SAFE_INPUT, '-i', `file:${inputPath}`, '-t', String(maxSeconds + 1), ...spec.args, ...STRIP_METADATA, `file:${outputPath}`]).catch(
        () => {
          throw new MediaRejectedError('INVALID_MEDIA', 'No pudimos procesar el archivo. ¿Está dañado?');
        },
      );

      const output = await this.probe(outputPath);
      const durationMs = Math.round(Number(output.format.duration ?? '0') * 1000);
      if (!Number.isFinite(durationMs) || durationMs <= 0) throw new MediaRejectedError('INVALID_MEDIA', 'El archivo está vacío o dañado');
      if (durationMs > maxSeconds * 1000) {
        throw new MediaRejectedError('MEDIA_TOO_LONG', `La duración máxima es de ${Math.floor(maxSeconds / 60)} minutos`);
      }
      const video = output.streams.find((stream) => stream.codec_type === 'video');
      return {
        data: await readFile(outputPath),
        mimeType: spec.mimeType,
        durationMs,
        width: video?.width ?? null,
        height: video?.height ?? null,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
      this.release();
    }
  }

  private async probe(path: string): Promise<Probe> {
    try {
      const stdout = await this.run(this.ffprobePath, [
        '-v', 'error', '-protocol_whitelist', 'file',
        '-show_entries', 'format=duration:stream=codec_type,width,height',
        '-of', 'json', `file:${path}`,
      ]);
      return probeSchema.parse(JSON.parse(stdout));
    } catch {
      throw new MediaRejectedError('INVALID_MEDIA', 'El archivo no es un audio o video válido');
    }
  }

  private run(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true, killSignal: 'SIGKILL' }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }

  /** Semáforo simple: como mucho MAX_CONCURRENT conversiones a la vez (evita saturar la CPU). */
  private acquire(): Promise<void> {
    if (this.running < MAX_CONCURRENT) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => resolve()));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.running--;
  }
}
