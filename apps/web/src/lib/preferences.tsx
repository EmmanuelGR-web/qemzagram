'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type FontSize = 'sm' | 'md' | 'lg';
export type ChatBackground = 'plain' | 'soft' | 'dots' | 'waves';

export interface Preferences {
  theme: ThemeMode;
  fontSize: FontSize;
  chatBackground: ChatBackground;
}

const STORAGE_KEY = 'qz:preferences';
const DEFAULTS: Preferences = { theme: 'system', fontSize: 'md', chatBackground: 'soft' };

const PreferencesContext = createContext<{ preferences: Preferences; update: (patch: Partial<Preferences>) => void } | null>(null);

function read(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

/** Preferencias visuales del usuario (tema, tamaño de texto, fondo de chat). Se guardan solo en este dispositivo. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);

  useEffect(() => setPreferences(read()), []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    root.dataset.font = preferences.fontSize;
    root.dataset.chatbg = preferences.chatBackground;
  }, [preferences]);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* modo privado: se aplica igual en esta sesión */
      }
      return next;
    });
  }, []);

  const value = useMemo(() => ({ preferences, update }), [preferences, update]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences debe usarse dentro de <PreferencesProvider>');
  return context;
}
