'use client';

import { VIDEO_MAX_SECONDS } from '@qemzagram/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon } from '@/components/icons';
import { formatDuration } from '@/lib/messages';

type Facing = 'environment' | 'user';

interface Props {
  mode: 'photo' | 'video';
  /** Foto o video listo: pasa a la vista previa normal (el servidor lo valida y limpia igual que cualquier subida). */
  onCapture: (file: File) => void;
  onClose: () => void;
  /** No hay cámara o no hay permiso: se ofrece elegir un archivo. */
  onFallback: () => void;
  /** Duración máxima de un video (por defecto la del chat; los estados admiten menos). */
  maxSeconds?: number;
}

const VIDEO_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

/** ¿El navegador permite abrir la cámara desde la página? (requiere HTTPS o localhost) */
export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Cámara dentro de la app (getUserMedia). A diferencia de <input capture>, que en la PC y en algunos
 * celulares abre el selector de archivos, esto enciende la cámara en todos los dispositivos.
 */
export function CameraCapture({ mode, onCapture, onClose, onFallback, maxSeconds = VIDEO_MAX_SECONDS }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  /** true al cerrar: una grabación en curso se descarta en vez de enviarse a la vista previa. */
  const closed = useRef(false);
  const [facing, setFacing] = useState<Facing>('environment');
  const [canSwitch, setCanSwitch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Enciende (o cambia) la cámara.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);
    stopStream();
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: mode === 'video',
      })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((track) => track.stop());
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCanSwitch(devices.filter((device) => device.kind === 'videoinput').length > 1);
        setReady(true);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const name = caught instanceof DOMException ? caught.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'No diste permiso para usar la cámara. Podés habilitarlo en la configuración del navegador (ícono del candado).'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No encontramos ninguna cámara en este dispositivo.'
              : 'No pudimos encender la cámara. Puede estar siendo usada por otra aplicación.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [facing, mode, stopStream]);

  // Al cerrar: se apaga la cámara (se apaga la luz de la cámara).
  useEffect(() => {
    closed.current = false; // React (modo estricto) monta dos veces en desarrollo: se reinicia al montar.
    return () => {
      closed.current = true;
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      stopStream();
    };
  }, [stopStream]);

  // Esc para cerrar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const finish = useCallback(
    (file: File) => {
      stopStream();
      onCapture(file);
    },
    [onCapture, stopStream],
  );

  function takePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    if (facing === 'user') {
      // La vista previa de la cámara frontal se muestra espejada; la foto también, como en las apps de cámara.
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && finish(new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.9);
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setError('Tu navegador no permite grabar video desde la página.');
      return;
    }
    const mimeType = VIDEO_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    // ~1,5 Mbps: 3 minutos ≈ 34 MB, por debajo del máximo de 50 MB.
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 1_500_000 });
    chunks.current = [];
    recorder.ondataavailable = (event) => event.data.size > 0 && chunks.current.push(event.data);
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks.current, { type });
      if (closed.current) return;
      setRecording(false);
      if (blob.size > 0) finish(new File([blob], `video-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type }));
    };
    recorderRef.current = recorder;
    recorder.start(500);
    setRecording(true);
    setSeconds(0);
  }

  // Contador de grabación y corte automático al llegar al máximo.
  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds && recorderRef.current?.state === 'recording') recorderRef.current.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recording, maxSeconds]);

  return (
    <div className="camera" role="dialog" aria-modal="true" aria-label={mode === 'photo' ? 'Tomar foto' : 'Grabar video'}>
      <button type="button" className="icon-btn camera-close" onClick={onClose} aria-label="Cerrar cámara">
        <CloseIcon />
      </button>

      {error ? (
        <div className="camera-error">
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={onFallback}>
            Elegir un archivo
          </button>
        </div>
      ) : (
        <video ref={videoRef} className="camera-view" data-mirror={facing === 'user'} playsInline muted autoPlay />
      )}

      {!error && (
        <div className="camera-controls">
          {recording && (
            <span className="camera-timer">
              <span className="recording-dot" aria-hidden="true" /> {formatDuration(seconds * 1000)} / {formatDuration(maxSeconds * 1000)}
            </span>
          )}
          <span className="camera-side" />
          {mode === 'photo' ? (
            <button type="button" className="camera-shutter" onClick={takePhoto} disabled={!ready} aria-label="Sacar foto" />
          ) : (
            <button
              type="button"
              className="camera-shutter"
              data-video="true"
              data-recording={recording}
              onClick={() => (recording ? recorderRef.current?.stop() : startRecording())}
              disabled={!ready}
              aria-label={recording ? 'Terminar grabación' : 'Empezar a grabar'}
            />
          )}
          <span className="camera-side">
            {canSwitch && !recording && (
              <button type="button" className="btn btn-glass btn-sm" onClick={() => setFacing((value) => (value === 'user' ? 'environment' : 'user'))}>
                Girar
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
