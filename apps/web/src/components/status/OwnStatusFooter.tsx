'use client';

import type { StatusDto, StatusViewDto } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { CloseIcon, TrashIcon, UserIcon } from '@/components/icons';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/statuses';

interface Props {
  status: StatusDto;
  /** Pausa el visor mientras está abierta la lista o la confirmación. */
  pause: (paused: boolean) => void;
  onDeleted: (id: string) => void;
}

/** Pie del visor en los estados PROPIOS: "Visto por" y "Borrar". */
export function OwnStatusFooter({ status, pause, onDeleted }: Props) {
  const [views, setViews] = useState<StatusViewDto[] | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Al pasar a otro estado se cierra la lista.
  useEffect(() => {
    setOpen(false);
    setViews(null);
    setError(null);
  }, [status.id]);

  useEffect(() => {
    pause(open);
    return () => pause(false);
  }, [open, pause]);

  async function showViews() {
    setOpen(true);
    try {
      setViews(await api<StatusViewDto[]>(`/statuses/${status.id}/views`));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function remove() {
    pause(true);
    const confirmed = window.confirm('¿Borrar este estado? Nadie más lo va a poder ver.');
    pause(false);
    if (!confirmed) return;
    setBusy(true);
    try {
      await api(`/statuses/${status.id}`, { method: 'DELETE' });
      onDeleted(status.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  const count = status.viewCount ?? 0;
  return (
    <>
      <button className="btn btn-ghost btn-sm" onClick={showViews}>
        <UserIcon /> {count === 1 ? 'Visto por 1 persona' : `Visto por ${count} personas`}
      </button>
      <button className="btn btn-ghost btn-sm" onClick={remove} disabled={busy} aria-label="Borrar estado">
        <TrashIcon /> Borrar
      </button>

      {open && (
        <div className="status-sheet" role="dialog" aria-label="Visto por">
          <header>
            <strong>Visto por</strong>
            <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Cerrar">
              <CloseIcon />
            </button>
          </header>
          {error && <p className="alert alert-error">{error}</p>}
          {views === null && !error && <p className="muted">Cargando…</p>}
          {views?.length === 0 && <p className="muted">Todavía nadie lo vio.</p>}
          <ul className="status-views">
            {views?.map((view) => (
              <li key={view.user.id} className="pick-item">
                <Avatar user={view.user} size={38} />
                <span>
                  <strong>{view.user.displayName}</strong>
                  <small className="muted">{timeAgo(view.viewedAt)}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!open && error && <p className="alert alert-error status-sheet-error">{error}</p>}
    </>
  );
}
