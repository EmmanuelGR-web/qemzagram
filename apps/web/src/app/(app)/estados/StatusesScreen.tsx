'use client';

import type { StatusDto, StatusOverviewDto } from '@qemzagram/shared';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { PlusIcon } from '@/components/icons';
import { StatusViewer } from '@/components/status/StatusViewer';
import { TextStatusEditor } from '@/components/status/TextStatusEditor';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { statusPreview, timeAgo } from '@/lib/statuses';

type Viewing = { type: 'mine' } | { type: 'feed'; position: number };

export function StatusesScreen() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<StatusOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [editor, setEditor] = useState(false);

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

  const closeViewer = useCallback(() => setViewing(null), []);

  if (!user) return null;
  const mine = overview?.mine ?? [];
  const feed = overview?.feed ?? [];
  const lastMine = mine.at(-1);
  const current = viewing?.type === 'feed' ? feed[viewing.position] : undefined;

  function created(status: StatusDto) {
    setEditor(false);
    setOverview((previous) => (previous ? { ...previous, mine: [...previous.mine, status] } : previous));
  }

  return (
    <div className="page">
      <h1>Estados</h1>
      <p className="muted">Fotos, videos y textos que desaparecen a las 24 horas.</p>

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
        </div>
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
        {feed.map((item, position) => {
          const last = item.statuses.at(-1);
          return (
            <li key={item.user.id}>
              <button className="status-person" onClick={() => setViewing({ type: 'feed', position })}>
                <span className="status-ring" data-state="new">
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

      {viewing?.type === 'mine' && mine.length > 0 && (
        <StatusViewer user={user} statuses={mine} onClose={closeViewer} onFinished={closeViewer} onMediaError={() => void load()} />
      )}
      {current && viewing?.type === 'feed' && (
        <StatusViewer
          key={current.user.id}
          user={current.user}
          statuses={current.statuses}
          onClose={closeViewer}
          onFinished={() => setViewing(viewing.position + 1 < feed.length ? { type: 'feed', position: viewing.position + 1 } : null)}
          onPreviousUser={viewing.position > 0 ? () => setViewing({ type: 'feed', position: viewing.position - 1 }) : undefined}
          onMediaError={() => void load()}
        />
      )}
    </div>
  );
}
