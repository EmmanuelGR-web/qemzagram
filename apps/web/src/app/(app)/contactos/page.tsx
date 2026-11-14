'use client';

import type { ContactDto, ConversationDto } from '@qemzagram/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import { api, errorMessage } from '@/lib/api';

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDto[] | null>(null);
  const [tag, setTag] = useState('');
  const [alias, setAlias] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setContacts(await api<ContactDto[]>('/contacts'));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const added = await api<ContactDto>('/contacts', { body: { tag, alias: alias.trim() || undefined } });
      setNotice(`@${added.user.tag} se agregó a tu agenda.`);
      setTag('');
      setAlias('');
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function chat(contact: ContactDto) {
    try {
      const conversation = await api<ConversationDto>('/chats/direct', { body: { tag: contact.user.tag } });
      router.push(`/chats/${conversation.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function remove(contact: ContactDto) {
    if (!window.confirm(`¿Quitar a @${contact.user.tag} de tu agenda?`)) return;
    try {
      await api(`/contacts/${contact.user.id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="page">
      <h1>Contactos</h1>
      <p className="muted">Tu agenda funciona con tags: agregá a alguien y podés chatear o armar grupos con esa persona.</p>

      <form onSubmit={add} className="card form">
        <h3>Agregar por tag</h3>
        <div className="inline-form">
          <div className="input-wrap prefixed">
            <span className="prefix">@</span>
            <input value={tag.replace(/^@/, '')} onChange={(event) => setTag(event.target.value)} placeholder="tag" autoCapitalize="none" maxLength={20} aria-label="Tag" />
          </div>
          <input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="Apodo (opcional)" maxLength={40} aria-label="Apodo" />
          <button className="btn btn-primary" disabled={busy || tag.replace(/^@/, '').length < 3}>
            Agregar
          </button>
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="alert alert-ok">{notice}</p>}
      </form>

      <h3 className="section-title">Mi agenda {contacts && `(${contacts.length})`}</h3>
      {contacts === null && <p className="muted">Cargando…</p>}
      {contacts?.length === 0 && <p className="empty-card">Tu agenda está vacía. Pedile su tag a un amigo y agregalo arriba.</p>}
      <ul className="contact-list">
        {contacts?.map((contact) => (
          <li key={contact.user.id} className="contact-row">
            <Link href={`/u/${contact.user.tag}`} className="contact-link">
              <Avatar user={contact.user} size={48} />
              <span>
                <strong>{contact.alias ?? contact.user.displayName}</strong>
                <small>@{contact.user.tag}{contact.blocked && ' · Bloqueado'}</small>
              </span>
            </Link>
            <div className="contact-actions">
              <button className="btn btn-primary btn-sm" onClick={() => chat(contact)} disabled={contact.blocked}>
                Chatear
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => remove(contact)}>
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
