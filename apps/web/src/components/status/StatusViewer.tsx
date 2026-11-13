'use client';

import type { PublicUser, StatusDto } from '@qemzagram/shared';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/Avatar';
import { CloseIcon } from '@/components/icons';
import { mediaUrl } from '@/lib/api';
import { STATUS_DISPLAY_MS, timeAgo } from '@/lib/statuses';

interface Props {
  user: PublicUser;
  statuses: StatusDto[];
  /** Índice del estado con el que se abre. */
  startIndex?: number;
  onClose: () => void;
  /** Se terminaron los estados de esta persona (la página puede pasar a la siguiente). */
  onFinished: () => void;
  /** Volver atrás desde el primer estado (la página puede abrir a la persona anterior). */
  onPreviousUser?: () => void;
  /** Se muestra un estado (para marcarlo como visto). */
  onShown?: (status: StatusDto) => void;
  /** Una foto o video no cargó (URL o sesión vencida): la página renueva los datos. */
  onMediaError?: () => void;
  /** Acciones extra al pie (por ejemplo "Visto por" y "Borrar" en los estados propios). */
  footer?: (status: StatusDto, pause: (paused: boolean) => void) => ReactNode;
}

/**
 * Visor de estados a pantalla completa: barras de progreso, avance automático,
 * tocar a la izquierda/derecha para retroceder/avanzar y mantener apretado para pausar.
 */
export function StatusViewer({ user, statuses, startIndex = 0, onClose, onFinished, onPreviousUser, onShown, onMediaError, footer }: Props) {
  const [index, setIndex] = useState(() => Math.min(startIndex, Math.max(0, statuses.length - 1)));
  const [progress, setProgress] = useState(0);
  const [held, setHeld] = useState(false);
  const [externalPause, setExternalPause] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const status = statuses[index];
  const paused = held || externalPause;

  const next = useCallback(() => {
    setProgress(0);
    if (index + 1 < statuses.length) setIndex(index + 1);
    else onFinished();
  }, [index, statuses.length, onFinished]);

  const previous = useCallback(() => {
    setProgress(0);
    if (index > 0) setIndex(index - 1);
    else if (onPreviousUser) onPreviousUser();
    else if (videoRef.current) videoRef.current.currentTime = 0;
  }, [index, onPreviousUser]);

  // Si la lista se achica (por ejemplo, se borró un estado), se corrige el índice.
  useEffect(() => {
    if (statuses.length === 0) onClose();
    else if (index >= statuses.length) setIndex(statuses.length - 1);
  }, [statuses.length, index, onClose]);

  useEffect(() => {
    if (status) onShown?.(status);
    // Solo cuando cambia el estado mostrado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.id]);

  // Avance automático de textos y fotos.
  useEffect(() => {
    if (!status || status.kind === 'video' || paused) return;
    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      const delta = time - last;
      last = time;
      setProgress((value) => {
        const updated = value + delta / STATUS_DISPLAY_MS;
        return updated >= 1 ? 1 : updated;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status, paused]);

  useEffect(() => {
    if (progress >= 1 && status?.kind !== 'video') next();
  }, [progress, status?.kind, next]);

  // El video se pausa junto con el visor.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch(() => undefined);
  }, [paused, status?.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') next();
      else if (event.key === 'ArrowLeft') previous();
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, next, previous]);

  if (!status) return null;
  const src = mediaUrl(status.media?.url) ?? '';

  return (
    <div className="status-viewer" role="dialog" aria-modal="true" aria-label={`Estados de ${user.displayName}`}>
      <div className="status-stage">
        <div className="status-progress" aria-hidden="true">
          {statuses.map((item, position) => (
            <span key={item.id}>
              <span style={{ transform: `scaleX(${position < index ? 1 : position === index ? progress : 0})` }} />
            </span>
          ))}
        </div>

        <header className="status-viewer-head">
          <Avatar user={user} size={38} />
          <span>
            <strong>{user.displayName}</strong>
            <small>{timeAgo(status.createdAt)}</small>
          </span>
          <button className="icon-btn status-viewer-close" onClick={onClose} aria-label="Cerrar">
            <CloseIcon />
          </button>
        </header>

        <div
          className="status-content"
          onPointerDown={() => setHeld(true)}
          onPointerUp={(event) => {
            setHeld(false);
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX - box.left < box.width / 3) previous();
            else next();
          }}
          onPointerLeave={() => setHeld(false)}
          onPointerCancel={() => setHeld(false)}
        >
          {status.kind === 'text' && (
            <div className="status-bg status-text" data-bg={status.background ?? 'rojo'}>
              <p>{status.body}</p>
            </div>
          )}
          {status.kind === 'image' && <img className="status-media" src={src} alt={status.body || `Foto de ${user.displayName}`} onError={onMediaError} draggable={false} />}
          {status.kind === 'video' && (
            <video
              key={status.id}
              ref={videoRef}
              className="status-media"
              src={src}
              playsInline
              autoPlay
              onTimeUpdate={(event) => {
                const video = event.currentTarget;
                if (video.duration > 0) setProgress(video.currentTime / video.duration);
              }}
              onEnded={next}
              onError={onMediaError}
              aria-label={status.body || `Video de ${user.displayName}`}
            />
          )}
          {status.kind !== 'text' && status.body && <p className="status-caption">{status.body}</p>}
        </div>

        {footer && <footer className="status-viewer-foot">{footer(status, setExternalPause)}</footer>}
      </div>
    </div>
  );
}
