import type { PushConfigDto } from '@qemzagram/shared';
import { api } from './api';

export type PushState = 'unsupported' | 'unavailable' | 'denied' | 'enabled' | 'disabled';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Registra el service worker (necesario para recibir avisos con la app cerrada). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/** La clave VAPID viaja en base64url; el navegador la necesita como bytes. */
function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const { publicKey } = await api<PushConfigDto>('/push/config');
  if (!publicKey) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? 'enabled' : 'disabled';
}

/** Pide permiso y activa las notificaciones en ESTE dispositivo. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const { publicKey } = await api<PushConfigDto>('/push/config');
  if (!publicKey) return 'unavailable';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
  await api('/push/subscriptions', { body: subscription.toJSON() });
  return 'enabled';
}

/** Desactiva las notificaciones en ESTE dispositivo (también se usa al cerrar sesión). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api('/push/subscriptions/remove', { body: { endpoint: subscription.endpoint } }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}
