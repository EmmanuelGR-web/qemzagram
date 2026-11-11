'use client';

import type { ConversationDto, MessageDto } from '@qemzagram/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useRealtimeEvent } from './realtime-context';

interface ChatsState {
  conversations: ConversationDto[];
  loading: boolean;
  reload: () => Promise<void>;
  upsert: (conversation: ConversationDto) => void;
  remove: (conversationId: string) => void;
}

const ChatsContext = createContext<ChatsState | null>(null);

const lastActivity = (conversation: ConversationDto) => conversation.lastMessage?.createdAt ?? conversation.createdAt;
const sortByActivity = (list: ConversationDto[]) => [...list].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));

export function ChatsProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      setConversations(sortByActivity(await api<ConversationDto[]>('/chats')));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const upsert = useCallback((conversation: ConversationDto) => {
    setConversations((current) => sortByActivity([conversation, ...current.filter((item) => item.id !== conversation.id)]));
  }, []);

  const remove = useCallback((conversationId: string) => {
    setConversations((current) => current.filter((item) => item.id !== conversationId));
  }, []);

  useRealtimeEvent('chat:created', upsert);
  useRealtimeEvent('chat:updated', upsert);
  useRealtimeEvent('chat:message', (message: MessageDto) => {
    setConversations((current) => {
      const target = current.find((item) => item.id === message.conversationId);
      if (!target) {
        void reload();
        return current;
      }
      return sortByActivity(current.map((item) => (item.id === target.id ? { ...item, lastMessage: message } : item)));
    });
  });

  const value = useMemo(() => ({ conversations, loading, reload, upsert, remove }), [conversations, loading, reload, upsert, remove]);
  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats(): ChatsState {
  const context = useContext(ChatsContext);
  if (!context) throw new Error('useChats debe usarse dentro de <ChatsProvider>');
  return context;
}

/** Título y persona "principal" de una conversación, según quién la mira. */
export function describeConversation(conversation: ConversationDto, myId: string) {
  if (conversation.type === 'group') {
    return { title: conversation.title ?? 'Grupo', subject: null, subtitle: `${conversation.members.length} miembros` };
  }
  const other = conversation.members.find((member) => member.user.id !== myId)?.user;
  return { title: other?.displayName ?? 'Conversación', subject: other ?? null, subtitle: other ? `@${other.tag}` : '' };
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}
