'use client';

import {
  decryptKeyBackup,
  encryptKeyBackup,
  generateIdentity,
  generateRecoveryCode,
  toNonExtractable,
  type E2eeKeyDto,
  type MyE2eeKeyDto,
} from '@qemzagram/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth-context';
import { loadDeviceKey, saveDeviceKey, type DeviceKey } from './e2ee-store';

/**
 * - `missing`: la cuenta todavía no tiene claves (hay que crearlas y guardar el código).
 * - `locked`: la cuenta tiene claves pero ESTE dispositivo no (hace falta el código de recuperación).
 * - `ready`: se puede cifrar y descifrar.
 * - `unsupported`: el navegador no tiene WebCrypto o IndexedDB (por ejemplo, fuera de HTTPS).
 */
export type E2eeStatus = 'loading' | 'unsupported' | 'missing' | 'locked' | 'ready' | 'error';

export interface PreparedKeys {
  /** El código que la persona tiene que guardar ANTES de publicar las claves. */
  code: string;
  publish: (password?: string) => Promise<void>;
}

interface E2eeState {
  status: E2eeStatus;
  device: DeviceKey | null;
  /** La persona cerró el aviso por esta sesión (los mensajes cifrados se ven bloqueados). */
  dismissed: boolean;
  dismiss: () => void;
  prepareKeys: () => Promise<PreparedKeys>;
  restore: (code: string) => Promise<void>;
  /** Claves (también viejas) por id, con caché: para verificar quién envió cada mensaje. */
  keysById: (ids: string[]) => Promise<Map<string, E2eeKeyDto>>;
}

const E2eeContext = createContext<E2eeState | null>(null);

const supported = () => typeof window !== 'undefined' && Boolean(window.crypto?.subtle) && typeof indexedDB !== 'undefined';

export function E2eeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<E2eeStatus>('loading');
  const [device, setDevice] = useState<DeviceKey | null>(null);
  const [server, setServer] = useState<MyE2eeKeyDto | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const cache = useRef(new Map<string, E2eeKeyDto>());

  const refresh = useCallback(async () => {
    if (!userId) return;
    if (!supported()) {
      setStatus('unsupported');
      return;
    }
    try {
      const [mine, local] = await Promise.all([api<MyE2eeKeyDto>('/e2ee/keys/me'), loadDeviceKey(userId)]);
      setServer(mine);
      if (!mine.key) {
        setDevice(null);
        setStatus('missing');
      } else if (local && local.keyId === mine.key.id) {
        setDevice(local);
        setStatus('ready');
      } else {
        // Sin clave local, o la clave cambió en otro dispositivo: hay que abrir la copia con el código.
        setDevice(null);
        setStatus('locked');
      }
    } catch {
      setStatus('error');
    }
  }, [userId]);

  useEffect(() => {
    cache.current.clear();
    setDismissed(false);
    void refresh();
  }, [refresh]);

  const prepareKeys = useCallback(async (): Promise<PreparedKeys> => {
    if (!userId) throw new Error('Sin sesión');
    const identity = await generateIdentity();
    const code = generateRecoveryCode();
    return {
      code,
      publish: async (password?: string) => {
        const backup = await encryptKeyBackup(identity.privateKey, userId, code);
        const published = await api<MyE2eeKeyDto>('/e2ee/keys', { body: { publicKey: identity.publicJwk, backup, ...(password ? { password } : {}) } });
        if (!published.key) throw new Error('No se pudo guardar la clave');
        const local: DeviceKey = { userId, keyId: published.key.id, privateKey: await toNonExtractable(identity.privateKey), publicJwk: identity.publicJwk };
        await saveDeviceKey(local);
        setServer(published);
        setDevice(local);
        setStatus('ready');
      },
    };
  }, [userId]);

  const restore = useCallback(
    async (code: string) => {
      if (!userId || !server?.key || !server.backup) throw new Error('No hay copia de seguridad');
      const opened = await decryptKeyBackup(server.backup, userId, code);
      if (opened.publicJwk.x !== server.key.publicKey.x || opened.publicJwk.y !== server.key.publicKey.y) {
        throw new Error('La copia no coincide con la clave publicada');
      }
      const local: DeviceKey = { userId, keyId: server.key.id, privateKey: opened.privateKey, publicJwk: opened.publicJwk };
      await saveDeviceKey(local);
      setDevice(local);
      setStatus('ready');
    },
    [userId, server],
  );

  const keysById = useCallback(async (ids: string[]) => {
    const missing = [...new Set(ids)].filter((id) => !cache.current.has(id));
    for (let index = 0; index < missing.length; index += 50) {
      const found = await api<E2eeKeyDto[]>('/e2ee/keys/lookup', { body: { ids: missing.slice(index, index + 50) } });
      for (const key of found) cache.current.set(key.id, key);
    }
    return new Map(ids.flatMap((id) => {
      const key = cache.current.get(id);
      return key ? [[id, key] as const] : [];
    }));
  }, []);

  const dismiss = useCallback(() => setDismissed(true), []);

  const value = useMemo(
    () => ({ status, device, dismissed, dismiss, prepareKeys, restore, keysById }),
    [status, device, dismissed, dismiss, prepareKeys, restore, keysById],
  );
  return <E2eeContext.Provider value={value}>{children}</E2eeContext.Provider>;
}

export function useE2ee(): E2eeState {
  const context = useContext(E2eeContext);
  if (!context) throw new Error('useE2ee debe usarse dentro de <E2eeProvider>');
  return context;
}
