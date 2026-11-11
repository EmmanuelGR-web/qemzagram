'use client';

import { GROUP_MAX_MEMBERS, type ContactDto, type ConversationDto } from '@qemzagram/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';
import { useChats } from '@/lib/chats-context';

export function NewChatDialog({ mode, onClose }: { mode: 'direct' | 'group'; onClose: () => void }) {
  const router = useRouter();
  const { upsert } = useChats();
  const [contacts, setContacts] = useState<ContactDto[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ContactDto[]>('/contacts').then(setContacts).catch((caught: unknown) => setError(errorMessage(caught)));
  }, []);

  async function openDirect(tag: string) {
    setBusy(true);
    try {
      const conversation = await api<ConversationDto>('/chats/direct', { body: { tag } });
      upsert(conversation);
      onClose();
      router.push(`/chats/${conversation.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const conversation = await api<ConversationDto>('/chats/groups', { body: { title, memberTags: selected } });
      upsert(conversation);
      onClose();
      router.push(`/chats/${conversation.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  const toggle = (tag: string) =>
    setSelected((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : current.length < GROUP_MAX_MEMBERS - 1 ? [...current, tag] : current));

  return (
    <Modal title={mode === 'direct' ? 'Nuevo chat' : 'Nuevo grupo'} onClose={onClose}>
      {contacts === null && !error && <p className="muted">Cargando agenda…</p>}
      {contacts?.length === 0 && (
        <p className="muted">
          Tu agenda está vacía. <Link href="/contactos" onClick={onClose}>Agregá a alguien por su tag</Link> para empezar.
        </p>
      )}
      <form onSubmit={createGroup} className="form">
        {mode === 'group' && (
          <div className="field">
            <label htmlFor="group-title">Nombre del grupo</label>
            <input id="group-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={50} required />
            <small className="hint">
              Elegí hasta {GROUP_MAX_MEMBERS - 1} personas (el grupo admite {GROUP_MAX_MEMBERS} con vos). Seleccionadas: {selected.length}
            </small>
          </div>
        )}
        <ul className="pick-list">
          {contacts?.map((contact) => (
            <li key={contact.user.id}>
              {mode === 'direct' ? (
                <button type="button" className="pick-item" disabled={busy} onClick={() => openDirect(contact.user.tag)}>
                  <Avatar user={contact.user} size={40} />
                  <span>
                    <strong>{contact.alias ?? contact.user.displayName}</strong>
                    <small>@{contact.user.tag}</small>
                  </span>
                </button>
              ) : (
                <label className="pick-item">
                  <input type="checkbox" checked={selected.includes(contact.user.tag)} onChange={() => toggle(contact.user.tag)} />
                  <Avatar user={contact.user} size={40} />
                  <span>
                    <strong>{contact.alias ?? contact.user.displayName}</strong>
                    <small>@{contact.user.tag}</small>
                  </span>
                </label>
              )}
            </li>
          ))}
        </ul>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {mode === 'group' && (
          <button className="btn btn-primary" disabled={busy || selected.length === 0 || title.trim().length === 0}>
            {busy ? 'Creando…' : 'Crear grupo'}
          </button>
        )}
      </form>
    </Modal>
  );
}
