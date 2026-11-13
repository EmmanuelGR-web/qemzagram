'use client';

import type { ContactDto, StatusAudience, StatusPrivacyDto } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';

const OPTIONS: { value: StatusAudience; label: string; hint: string }[] = [
  { value: 'contacts', label: 'Mi agenda', hint: 'Todas las personas de tu agenda que también te agregaron.' },
  { value: 'except', label: 'Mi agenda excepto…', hint: 'Tu agenda, menos las personas que elijas.' },
  { value: 'only', label: 'Solo compartir con…', hint: 'Únicamente las personas que elijas.' },
];

export const AUDIENCE_LABELS: Record<StatusAudience, string> = { contacts: 'Mi agenda', except: 'Mi agenda excepto…', only: 'Solo compartir con…' };

/** "Quién puede ver mis estados": tres opciones; las dos listas se guardan por separado. */
export function StatusPrivacyDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (privacy: StatusPrivacyDto) => void }) {
  const [contacts, setContacts] = useState<ContactDto[] | null>(null);
  const [audience, setAudience] = useState<StatusAudience>('contacts');
  const [lists, setLists] = useState<{ except: Set<string>; only: Set<string> }>({ except: new Set(), only: new Set() });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api<StatusPrivacyDto>('/statuses/privacy'), api<ContactDto[]>('/contacts')])
      .then(([privacy, agenda]) => {
        setAudience(privacy.audience);
        setLists({ except: new Set(privacy.except.map((user) => user.tag)), only: new Set(privacy.only.map((user) => user.tag)) });
        setContacts(agenda);
      })
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, []);

  const list = audience === 'contacts' ? null : audience;

  function toggle(tag: string) {
    if (!list) return;
    setLists((previous) => {
      const updated = new Set(previous[list]);
      if (updated.has(tag)) updated.delete(tag);
      else updated.add(tag);
      return { ...previous, [list]: updated };
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const saved = await api<StatusPrivacyDto>('/statuses/privacy', {
        method: 'PUT',
        body: { audience, except: [...lists.except], only: [...lists.only] },
      });
      onSaved(saved);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Modal title="Quién puede ver mis estados" onClose={onClose}>
      <div className="form">
        <div className="privacy-options" role="radiogroup" aria-label="Quién puede ver mis estados">
          {OPTIONS.map((option) => (
            <label key={option.value} className="privacy-option">
              <input type="radio" name="audience" checked={audience === option.value} onChange={() => setAudience(option.value)} />
              <span>
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
          ))}
        </div>

        {list && (
          <>
            <h4 className="section-title">
              {list === 'except' ? 'No compartir con' : 'Compartir solo con'} ({lists[list].size})
            </h4>
            {contacts === null && !error && <p className="muted">Cargando…</p>}
            {contacts?.length === 0 && <p className="muted">Tu agenda está vacía.</p>}
            <ul className="pick-list">
              {contacts?.map((contact) => (
                <li key={contact.user.id}>
                  <label className="pick-item">
                    <input type="checkbox" checked={lists[list].has(contact.user.tag)} onChange={() => toggle(contact.user.tag)} />
                    <Avatar user={contact.user} size={38} />
                    <span>
                      <strong>{contact.alias ?? contact.user.displayName}</strong>
                      <small className="muted">@{contact.user.tag}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="hint">El cambio rige al instante, también para los estados que ya publicaste.</p>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" onClick={save} disabled={busy || contacts === null}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}
