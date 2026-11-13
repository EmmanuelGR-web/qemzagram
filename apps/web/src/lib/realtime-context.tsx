'use client';

import type { ServerToClientEvents } from '@qemzagram/shared';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import { api } from './api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';
const EVENTS = ['chat:message', 'chat:created', 'chat:updated', 'status:changed'] as const satisfies readonly (keyof ServerToClientEvents)[];

type Handler<E extends keyof ServerToClientEvents> = ServerToClientEvents[E];
type AnyListener = (payload: unknown) => void;

interface RealtimeApi {
  subscribe: <E extends keyof ServerToClientEvents>(event: E, handler: Handler<E>) => () => void;
}

const RealtimeContext = createContext<RealtimeApi | null>(null);

/** Abre la conexión en tiempo real con un ticket de 60 s (la cookie de sesión nunca viaja al socket). */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const listeners = useRef(new Map<string, Set<AnyListener>>());

  useEffect(() => {
    const socket = io(WS_URL, {
      transports: ['websocket'],
      // En cada (re)conexión se pide un ticket nuevo: los tickets vencen a los 60 segundos.
      auth: (callback) => {
        api<{ ticket: string }>('/auth/ws-ticket', { method: 'POST' })
          .then(({ ticket }) => callback({ ticket }))
          .catch(() => callback({}));
      },
    });
    for (const event of EVENTS) {
      socket.on(event, (payload: unknown) => listeners.current.get(event)?.forEach((listener) => listener(payload)));
    }
    return () => {
      socket.close();
    };
  }, []);

  const value = useMemo<RealtimeApi>(
    () => ({
      subscribe: (event, handler) => {
        const set = listeners.current.get(event) ?? new Set<AnyListener>();
        const listener = handler as unknown as AnyListener;
        set.add(listener);
        listeners.current.set(event, set);
        return () => {
          set.delete(listener);
        };
      },
    }),
    [],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeEvent<E extends keyof ServerToClientEvents>(event: E, handler: Handler<E>): void {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error('useRealtimeEvent debe usarse dentro de <RealtimeProvider>');
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const forward = ((payload: unknown) => (latest.current as unknown as AnyListener)(payload)) as unknown as Handler<E>;
    return context.subscribe(event, forward);
  }, [context, event]);
}
