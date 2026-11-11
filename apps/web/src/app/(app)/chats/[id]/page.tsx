'use client';

import { GROUP_MAX_MEMBERS, MESSAGE_MAX_LENGTH, type ConversationDto, type MessageDto } from '@qemzagram/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import { BackIcon, GroupIcon, SendIcon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { describeConversation, formatTime, useChats } from '@/lib/chats-context';
import { useRealtimeEvent } from '@/lib/realtime-context';

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { upsert, remove } = useChats();
  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setConversation(null);
    setMessages([]);
    setError(null);
    Promise.all([api<ConversationDto>(`/chats/${id}`), api<MessageDto[]>(`/chats/${id}/messages?limit=100`)])
      .then(([loadedConversation, loadedMessages]) => {
        if (!active) return;
        setConversation(loadedConversation);
        setMessages(loadedMessages);
      })
      .catch((caught: unknown) => active && setError(errorMessage(caught)));
    return () => {
      active = false;
    };
  }, [id]);

  const append = useCallback((message: MessageDto) => {
    setMessages((current) => (current.some((item) => item.id === message.id) ? current : [...current, message]));
  }, []);

  useRealtimeEvent('chat:message', (message: MessageDto) => message.conversationId === id && append(message));
  useRealtimeEvent('chat:updated', (updated: ConversationDto) => updated.id === id && setConversation(updated));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await api<MessageDto>(`/chats/${id}/messages`, { body: { body } });
      append(message);
      setDraft('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  if (!user) return null;
  if (error && !conversation) {
    return (
      <div className="chat-empty">
        <p className="alert alert-error">{error}</p>
        <Link href="/chats" className="btn btn-ghost">
          Volver a mis chats
        </Link>
      </div>
    );
  }
  if (!conversation) return <div className="chat-empty muted">Cargando conversación…</div>;

  const info = describeConversation(conversation, user.id);
  const isGroup = conversation.type === 'group';
  const authors = new Map(conversation.members.map((member) => [member.user.id, member.user]));

  return (
    <div className="conversation">
      <header className="conversation-head">
        <Link href="/chats" className="icon-btn back-btn" aria-label="Volver">
          <BackIcon />
        </Link>
        <button className="conversation-title" onClick={() => setShowInfo(true)}>
          {info.subject ? <Avatar user={info.subject} size={40} /> : <span className="group-avatar"><GroupIcon /></span>}
          <span>
            <strong>{info.title}</strong>
            <small>{info.subtitle}</small>
          </span>
        </button>
      </header>

      <div className="messages" role="log" aria-live="polite">
        {messages.length === 0 && <p className="messages-empty">Todavía no hay mensajes. ¡Escribí el primero!</p>}
        {messages.map((message) => {
          const mine = message.senderId === user.id;
          const author = authors.get(message.senderId);
          return (
            <div key={message.id} className="message-row" data-mine={mine}>
              <div className="bubble">
                {isGroup && !mine && <span className="bubble-author">{author?.displayName ?? 'Ex miembro'}</span>}
                <span className="bubble-text">{message.body}</span>
                <time>{formatTime(message.createdAt)}</time>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="alert alert-error composer-error" role="alert">
          {error}
        </p>
      )}
      <form className="composer" onSubmit={send}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribí un mensaje"
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          aria-label="Mensaje"
        />
        <button className="send-btn" disabled={sending || draft.trim().length === 0} aria-label="Enviar">
          <SendIcon />
        </button>
      </form>

      {showInfo && (
        <ConversationInfo
          conversation={conversation}
          myId={user.id}
          onClose={() => setShowInfo(false)}
          onChanged={(updated) => {
            setConversation(updated);
            upsert(updated);
          }}
          onLeft={() => {
            remove(conversation.id);
            router.replace('/chats');
          }}
        />
      )}
    </div>
  );
}

function ConversationInfo(props: {
  conversation: ConversationDto;
  myId: string;
  onClose: () => void;
  onChanged: (conversation: ConversationDto) => void;
  onLeft: () => void;
}) {
  const { conversation, myId, onClose, onChanged, onLeft } = props;
  const [tag, setTag] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isGroup = conversation.type === 'group';
  const iAmAdmin = conversation.members.find((member) => member.user.id === myId)?.role === 'admin';

  async function add(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      onChanged(await api<ConversationDto>(`/chats/${conversation.id}/members`, { body: { tag } }));
      setTag('');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function leave() {
    if (!window.confirm('¿Salir de este grupo?')) return;
    try {
      await api(`/chats/${conversation.id}/members/me`, { method: 'DELETE' });
      onLeft();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <Modal title={isGroup ? (conversation.title ?? 'Grupo') : 'Información'} onClose={onClose}>
      <p className="muted small">{conversation.members.length} {conversation.members.length === 1 ? 'miembro' : 'miembros'}</p>
      <ul className="pick-list">
        {conversation.members.map((member) => (
          <li key={member.user.id}>
            <Link href={`/u/${member.user.tag}`} className="pick-item" onClick={onClose}>
              <Avatar user={member.user} size={40} />
              <span>
                <strong>
                  {member.user.displayName}
                  {member.user.id === myId && ' (vos)'}
                </strong>
                <small>@{member.user.tag}</small>
              </span>
              {member.role === 'admin' && <span className="badge">Admin</span>}
            </Link>
          </li>
        ))}
      </ul>
      {isGroup && iAmAdmin && conversation.members.length < GROUP_MAX_MEMBERS && (
        <form onSubmit={add} className="inline-form">
          <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="@tag de tu agenda" maxLength={21} aria-label="Tag a agregar" />
          <button className="btn btn-primary" disabled={tag.trim().length < 3}>
            Agregar
          </button>
        </form>
      )}
      {error && <p className="alert alert-error">{error}</p>}
      {isGroup && (
        <button className="btn btn-danger-ghost" onClick={leave}>
          Salir del grupo
        </button>
      )}
    </Modal>
  );
}
