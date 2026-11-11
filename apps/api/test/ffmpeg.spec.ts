import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegTranscoder } from '../src/media/ffmpeg.transcoder';
import { MediaRejectedError } from '../src/media/transcoder.port';

/**
 * Prueba de integración con el ffmpeg REAL: comprueba que los metadatos (incluida la ubicación GPS)
 * desaparecen al convertir. Si ffmpeg no está instalado (o FFMPEG_PATH no apunta a él), se saltea.
 */
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

function ffmpegInstalled(): boolean {
  try {
    execFileSync(FFMPEG, ['-version'], { stdio: 'ignore' });
    execFileSync(FFPROBE, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const describeIfFfmpeg = ffmpegInstalled() ? describe : describe.skip;

describeIfFfmpeg('ffmpeg real: conversión y limpieza de metadatos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qz-ffmpeg-test-'));
  const transcoder = new FfmpegTranscoder(FFMPEG, FFPROBE);

  /** Genera un archivo de prueba con ffmpeg (tono/colores sintéticos) y metadatos "secretos". */
  const generate = (name: string, args: string[]): Buffer => {
    const path = join(dir, name);
    execFileSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args, path]);
    return readFileSync(path);
  };

  /** Todas las etiquetas (globales y por pista) que ffprobe ve en un archivo. */
  const tags = (data: Buffer): string => {
    const path = join(dir, `probe-${Date.now()}`);
    writeFileSync(path, data);
    return execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', path]).toString();
  };

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('está disponible', async () => {
    expect(await transcoder.isAvailable()).toBe(true);
  });

  it('nota de voz: convierte a AAC/M4A y borra los metadatos', async () => {
    const input = generate('voz.webm', [
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-metadata', 'title=SECRETO-TITULO', '-metadata', 'artist=SECRETO-AUTOR',
      '-c:a', 'libopus',
    ]);
    expect(tags(input)).toContain('SECRETO');

    const result = await transcoder.transcode(input, 'voice', 300);
    expect(result.mimeType).toBe('audio/mp4');
    expect(result.durationMs).toBeGreaterThan(2500);
    expect(result.durationMs).toBeLessThan(3500);
    expect(tags(result.data)).not.toContain('SECRETO');
  });

  it('video: convierte a H.264/MP4, limita la resolución y borra la ubicación GPS', async () => {
    const input = generate('video.mov', [
      '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=10:duration=2',
      '-f', 'lavfi', '-i', 'sine=duration=2',
      '-metadata', 'location=+34.6037-058.3816/', '-metadata', 'title=SECRETO-VIDEO',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest',
    ]);
    expect(tags(input)).toContain('+34.6037');

    const result = await transcoder.transcode(input, 'video', 180);
    expect(result.mimeType).toBe('video/mp4');
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    const cleaned = tags(result.data);
    expect(cleaned).not.toContain('+34.6037');
    expect(cleaned).not.toContain('SECRETO');
  });

  it('rechaza lo demasiado largo y lo que no es audio/video', async () => {
    const long = generate('largo.webm', ['-f', 'lavfi', '-i', 'sine=duration=5', '-c:a', 'libopus']);
    await expect(transcoder.transcode(long, 'voice', 2)).rejects.toMatchObject({ code: 'MEDIA_TOO_LONG' });
    await expect(transcoder.transcode(Buffer.from('no soy un video'), 'video', 10)).rejects.toBeInstanceOf(MediaRejectedError);
    // un audio no sirve como video
    const audioOnly = generate('solo-audio.m4a', ['-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac']);
    await expect(transcoder.transcode(audioOnly, 'video', 10)).rejects.toMatchObject({ code: 'INVALID_MEDIA' });
  });
});
