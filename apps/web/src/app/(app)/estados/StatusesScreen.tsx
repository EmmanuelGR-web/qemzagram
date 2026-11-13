'use client';

import { STATUS_VIDEO_MAX_SECONDS, type StatusDto, type StatusOverviewDto } from '@qemzagram/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { CameraCapture, cameraSupported } from '@/components/chat/CameraCapture';
import { CameraIcon, ImageIcon, LockIcon, PlusIcon, VideoIcon } from '@/components/icons';
import { MediaStatusEditor } from '@/components/status/MediaStatusEditor';
import { OwnStatusFooter } from '@/components/status/OwnStatusFooter';
import { StatusPrivacyDialog } from '@/components/status/StatusPrivacyDialog';
import { StatusViewer } from '@/components/status/StatusViewer';
import { TextStatusEditor } from '@/components/status/TextStatusEditor';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useRealtimeEvent } from '@/lib/realtime-context';
import { statusPreview, timeAgo } from '@/lib/statuses';

/** Se sigue a la persona por id (no por posición): la lista puede reordenarse mientras se mira. */
type Viewing = { type: 'mine' } | { type: 'feed'; userId: string };

export function StatusesScreen() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<StatusOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [editor, setEditor] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [camera, setCamera] = useState<'photo' | 'video' | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const galleryInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await api<StatusOverviewDto>('/statuses'));
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
    // Los estados vencen: se refresca la lista cada minuto mientras la pantalla está abierta.
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // Alguien de la agenda publicó o borró un estado (o cambió quién los ve): se actualiza la lista.
  useRealtimeEvent('status:changed', () => void load());

  const closeViewer = useCallback(() => setViewing(null), []);

  /** Marca como visto (una vez) y lo refleja en la lista sin esperar a recargar. */
  const markSeen = useCallback((status: StatusDto) => {
    if (status.viewed) return;
    setOverview((previous) =>
      previous
        ? {
            ...previous,
            feed: previous.feed.map((item) => {
              if (item.user.id !== status.ownerId) return item;
              const statuses = item.statuses.map((entry) => (entry.id === status.id ? { ...entry, viewed: true } : entry));
              return { ...item, statuses, allViewed: statuses.every((entry) => entry.viewed) };
            }),
          }
        : previous,
    );
    // Si falla (por ejemplo, el estado ya venció) no pasa nada: es solo el registro de "visto".
    void api(`/statuses/${status.id}/view`, { method: 'POST' }).catch(() => undefined);
  }, []);

  if (!user) return null;
  const mine = overview?.mine ?? [];
  const feed = overview?.feed ?? [];
  const lastMine = mine.at(-1);
  const position = viewing?.type === 'feed' ? feed.findIndex((item) => item.user.id === viewing.userId) : -1;
  const current = position >= 0 ? feed[position] : undefined;
  const openFeed = (index: number) => {
    const item = feed[index];
    setViewing(item ? { type: 'feed', userId: item.user.id } : null);
  };

  /** Cámara dentro de la app; si el navegador no la permite, se usa el selector del sistema. */
  function openCamera(mode: 'photo' | 'video') {
    if (cameraSupported()) setCamera(mode);
    else (mode === 'photo' ? photoInput : videoInput).current?.click();
  }

  function created(status: StatusDto) {
    setEditor(false);
    setFile(null);
    setOverview((previous) => (previous ? { ...previous, mine: [...previous.mine, status] } : previous));
  }

  function deleted(id: string) {
    setOverview((previous) => (previous ? { ...previous, mine: previous.mine.filter((status) => status.id !== id) } : previous));
  }

  return (
    <div className="page">
      <h1>Estados</h1>
      <p className="muted">Fotos, videos y textos que desaparecen a las 24 horas.</p>
      <button className="status-privacy-link" onClick={() => setPrivacyOpen(true)}>
        <LockIcon /> Quién puede ver mis estados
      </button>
      {privacyOpen && <StatusPrivacyDialog onClose={() => setPrivacyOpen(false)} onSaved={() => setPrivacyOpen(false)} />}

      <section className="card status-mine">
        <button className="status-person" onClick={() => (mine.length > 0 ? setViewing({ type: 'mine' }) : setEditor(true))}>
          <span className="status-ring" data-state={mine.length > 0 ? 'mine' : 'empty'}>
            <Avatar user={user} size={54} />
          </span>
          <span className="status-person-body">
            <strong>Mi estado</strong>
            <small>
              {lastMine ? `${mine.length} ${mine.length === 1 ? 'estado' : 'estados'} · ${timeAgo(lastMine.createdAt)}` : 'Tocá para publicar un estado'}
            </small>
          </span>
        </button>
        <div className="status-actions">
          <button className="btn btn-primary btn-sm" onClick={() => setEditor(true)}>
            <PlusIcon /> Texto
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => openCamera('photo')}>
            <CameraIcon /> Foto
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => openCamera('video')}>
            <VideoIcon /> Video
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => galleryInput.current?.click()}>
            <ImageIcon /> Galería
          </button>
        </div>
        <input ref={galleryInput} type="file" accept="image/*,video/*" hidden onChange={(event) => { setFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
        <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { setFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
        <input ref={videoInput} type="file" accept="video/*" capture="environment" hidden onChange={(event) => { setFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
      </section>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}

      <h3 className="section-title">Recientes</h3>
      {overview === null && !error && <p className="muted">Cargando…</p>}
      {overview && feed.length === 0 && (
        <p className="empty-card">Todavía no hay estados de tu agenda. Solo ves los de personas que agregaste y que también te agregaron.</p>
      )}
      <ul className="status-list">
        {feed.map((item, index) => {
          const last = item.statuses.at(-1);
          return (
            <li key={item.user.id}>
              <button className="status-person" onClick={() => openFeed(index)} aria-label={`Ver estados de ${item.user.displayName}${item.allViewed ? '' : ' (nuevos)'}`}>
                <span className="status-ring" data-state={item.allViewed ? 'seen' : 'new'}>
                  <Avatar user={item.user} size={52} />
                </span>
                <span className="status-person-body">
                  <strong>{item.user.displayName}</strong>
                  <small>
                    {last ? `${timeAgo(last.createdAt)} · ${statusPreview(last)}` : ''}
                  </small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {editor && <TextStatusEditor onClose={() => setEditor(false)} onCreated={created} />}
      {file && <MediaStatusEditor key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onClose={() => setFile(null)} onCreated={created} />}
      {camera && (
        <CameraCapture
          mode={camera}
          maxSeconds={STATUS_VIDEO_MAX_SECONDS}
          onCapture={(captured) => {
            setCamera(null);
            setFile(captured);
          }}
          onClose={() => setCamera(null)}
          onFallback={() => {
            const mode = camera;
            setCamera(null);
            (mode === 'photo' ? photoInput : videoInput).current?.click();
          }}
        />
      )}

      {viewing?.type === 'mine' && mine.length > 0 && (
        <StatusViewer
          user={user}
          statuses={mine}
          onClose={closeViewer}
          onFinished={closeViewer}
          onMediaError={() => void load()}
          footer={(status, pause) => <OwnStatusFooter status={status} pause={pause} onDeleted={deleted} />}
        />
      )}
      {current && (
        <StatusViewer
          key={current.user.id}
          user={current.user}
          statuses={current.statuses}
          // Arranca en el primer estado que todavía no viste.
          startIndex={Math.max(0, current.statuses.findIndex((status) => !status.viewed))}
          onClose={closeViewer}
          onFinished={() => openFeed(position + 1)}
          onPreviousUser={position > 0 ? () => openFeed(position - 1) : undefined}
          onShown={markSeen}
          onMediaError={() => void load()}
        />
      )}
    </div>
  );
}
