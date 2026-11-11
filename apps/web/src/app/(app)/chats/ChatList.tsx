'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { GroupIcon, PlusIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth-context';
import { describeConversation, formatTime, useChats } from '@/lib/chats-context';
import { messagePreview } from '@/lib/messages';
import { NewChatDialog } from './NewChatDialog';

export function ChatList() {
  const { user } = useAuth();
  const { conversations, loading } = useChats();
  const params = useParams<{ id?: string }>();
  const [dialog, setDialog] = useState<'direct' | 'group' | null>(null);
  const [query, setQuery] = useState('');

  const items = useMemo(() => {
    if (!user) return [];
    const needle = query.trim().toLowerCase();
    return conversations.filter((conversation) => !needle || describeConversation(conversation, user.id).title.toLowerCase().includes(needle));
  }, [conversations, query, user]);

  if (!user) return null;

  return (
    <aside className="chat-list" aria-label="Tus conversaciones">
      <div className="chat-list-head">
        <h2>Chats</h2>
        <div className="chat-list-actions">
          <button className="icon-btn" onClick={() => setDialog('group')} aria-label="Nuevo grupo" title="Nuevo grupo">
            <GroupIcon />
          </button>
          <button className="icon-btn icon-btn-solid" onClick={() => setDialog('direct')} aria-label="Nuevo chat" title="Nuevo chat">
            <PlusIcon />
          </button>
        </div>
      </div>
      <input className="search" type="search" placeholder="Buscar conversación" value={query} onChange={(event) => setQuery(event.target.value)} />

      <ul className="chat-items">
        {loading && <li className="empty-hint">Cargando…</li>}
        {!loading && items.length === 0 && (
          <li className="empty-hint">
            {conversations.length === 0 ? (
              <>
                Todavía no tenés chats.
                <br />
                Agregá gente a tu <Link href="/contactos">agenda</Link> y empezá a hablar.
              </>
            ) : (
              'Sin resultados.'
            )}
          </li>
        )}
        {items.map((conversation) => {
          const info = describeConversation(conversation, user.id);
          const preview = conversation.lastMessage
            ? `${conversation.lastMessage.senderId === user.id ? 'Vos: ' : ''}${messagePreview(conversation.lastMessage)}`
            : 'Sin mensajes todavía';
          return (
            <li key={conversation.id}>
              <Link href={`/chats/${conversation.id}`} className="chat-item" aria-current={params.id === conversation.id ? 'page' : undefined}>
                {info.subject ? <Avatar user={info.subject} size={48} /> : <span className="group-avatar"><GroupIcon /></span>}
                <span className="chat-item-body">
                  <span className="chat-item-top">
                    <strong>{info.title}</strong>
                    {conversation.lastMessage && <time>{formatTime(conversation.lastMessage.createdAt)}</time>}
                  </span>
                  <span className="chat-item-preview">{preview}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {dialog && <NewChatDialog mode={dialog} onClose={() => setDialog(null)} />}
    </aside>
  );
}
