import type { PublicKeyJwk } from '@qemzagram/shared';

/**
 * Almacén LOCAL de claves (IndexedDB). La clave privada se guarda como CryptoKey NO EXPORTABLE:
 * el navegador la puede usar para descifrar, pero ningún script puede leer sus bytes.
 * No es un token de sesión (esos siguen solo en cookies HttpOnly): es la clave del dispositivo.
 */
export interface DeviceKey {
  userId: string;
  keyId: string;
  privateKey: CryptoKey;
  publicJwk: PublicKeyJwk;
}

const DB_NAME = 'qemzagram-e2ee';
const DB_VERSION = 1;
const KEYS = 'device-keys';
/** Última clave vista de cada contacto: si cambia, se avisa en el chat. */
const SEEN = 'seen-keys';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: 'userId' });
      if (!db.objectStoreNames.contains(SEEN)) db.createObjectStore(SEEN);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB'));
  });
}

async function run<T>(store: string, mode: IDBTransactionMode, action: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('Error de IndexedDB'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Transacción cancelada'));
    });
  } finally {
    db.close();
  }
}

export async function loadDeviceKey(userId: string): Promise<DeviceKey | null> {
  const found = await run<DeviceKey | undefined>(KEYS, 'readonly', (store) => store.get(userId) as IDBRequest<DeviceKey | undefined>);
  return found ?? null;
}

export async function saveDeviceKey(key: DeviceKey): Promise<void> {
  await run(KEYS, 'readwrite', (store) => store.put(key));
}

/** Al cerrar sesión: el dispositivo olvida la clave (para volver a leer, hace falta el código). */
export async function clearDeviceKeys(): Promise<void> {
  await run(KEYS, 'readwrite', (store) => store.clear());
  await run(SEEN, 'readwrite', (store) => store.clear());
}

export async function loadSeenKey(myId: string, otherId: string): Promise<string | null> {
  const found = await run<string | undefined>(SEEN, 'readonly', (store) => store.get(`${myId}:${otherId}`) as IDBRequest<string | undefined>);
  return found ?? null;
}

export async function saveSeenKey(myId: string, otherId: string, keyId: string): Promise<void> {
  await run(SEEN, 'readwrite', (store) => store.put(keyId, `${myId}:${otherId}`));
}
