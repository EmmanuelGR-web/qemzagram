'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Formatos que puede grabar cada navegador (Chrome/Firefox: WebM u Ogg con Opus; Safari: MP4). */
const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];

export type RecorderState = 'idle' | 'recording';

export interface Recording {
  blob: Blob;
  fileName: string;
}

/**
 * Graba una nota de voz con el micrófono. El navegador pide permiso la primera vez.
 * Requiere un contexto seguro (HTTPS o localhost). El límite de duración lo controla quien lo usa.
 */
export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const finish = useRef<((recording: Recording | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
    setState('idle');
    setSeconds(0);
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no permite grabar audio (o la página no se abrió con HTTPS).');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError('Necesitamos permiso para usar el micrófono. Revisá los permisos del navegador.');
      return;
    }
    const mimeType = CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const media = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 48_000 } : undefined);
    chunks.current = [];
    media.ondataavailable = (event) => event.data.size > 0 && chunks.current.push(event.data);
    media.onstop = () => {
      const type = media.mimeType || mimeType || 'audio/webm';
      const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const blob = new Blob(chunks.current, { type });
      finish.current?.(blob.size > 0 ? { blob, fileName: `nota-de-voz.${extension}` } : null);
      finish.current = null;
      cleanup();
    };
    recorder.current = media;
    media.start(250);
    setState('recording');
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
    }, 250);
  }, [cleanup]);

  /** Termina la grabación y devuelve el audio (o null si quedó vacío). */
  const stop = useCallback(
    () =>
      new Promise<Recording | null>((resolve) => {
        const media = recorder.current;
        if (!media || media.state === 'inactive') return resolve(null);
        finish.current = resolve;
        media.stop();
      }),
    [],
  );

  /** Descarta la grabación. */
  const cancel = useCallback(() => {
    finish.current = null;
    const media = recorder.current;
    if (media && media.state !== 'inactive') media.stop();
    else cleanup();
  }, [cleanup]);

  return { state, seconds, error, start, stop, cancel };
}
