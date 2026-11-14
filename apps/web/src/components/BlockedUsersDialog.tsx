'use client';

import type { BlockedUserDto } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { listBlocked, unblockUser } from '@/lib/blocks';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

/** Ajustes → Bloqueados: lista de personas bloqueadas, con "Desbloquear". */
export function BlockedUsersDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<BlockedUserDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    listBlocked()
      .then(setItems)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, []);

  async function unblock(item: BlockedUserDto) {
    setBusy(item.user.id);
    setError(null);
    try {
      await unblockUser(item.user.id);
      setItems((current) => current?.filter((other) => other.user.id !== item.user.id) ?? null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Personas bloqueadas" onClose={onClose}>
      {items === null && !error && <p className="muted">Cargando…</p>}
      {items?.length === 0 && <p className="muted">No bloqueaste a nadie.</p>}
      <ul className="contact-list">
        {items?.map((item) => (
          <li key={item.user.id} className="contact-row">
            <span className="contact-link">
              <Avatar user={item.user} size={40} />
              <span>
                <strong>{item.user.displayName}</strong>
                <small>Desde el {new Date(item.blockedAt).toLocaleDateString('es-AR')}</small>
              </span>
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => void unblock(item)} disabled={busy === item.user.id}>
              Desbloquear
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="alert alert-error">{error}</p>}
    </Modal>
  );
}
