'use client';

import type { SelfUser } from '@qemzagram/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import { clearDeviceKeys } from './e2ee-store';
import { disablePush } from './push';

interface AuthState {
  user: SelfUser | null;
  loading: boolean;
  setUser: (user: SelfUser | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SelfUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api<SelfUser>('/users/me')
      .then((me) => active && setUser(me))
      .catch((error: unknown) => {
        if (active && !(error instanceof ApiError && error.status === 401)) console.error(error);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const logout = useCallback(async () => {
    // Este dispositivo deja de recibir avisos de esta cuenta (antes de cerrar la sesión).
    await disablePush().catch(() => undefined);
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    // El dispositivo olvida la clave de cifrado: para volver a leer hace falta el código de recuperación.
    await clearDeviceKeys().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, setUser, logout }), [user, loading, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}
