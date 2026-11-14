/*
 * Service worker de Qemzagram: recibe las notificaciones push (llamadas y mensajes nuevos) aunque la app
 * esté cerrada. El contenido llega CIFRADO por el protocolo Web Push y NUNCA incluye el texto de los mensajes:
 * solo quién escribió (o el nombre del grupo).
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const ICON = '/icons/icon-192.png';

function callNoun(kind) {
  return kind === 'video' ? 'Videollamada' : 'Llamada';
}

/** Solo se aceptan avisos con la forma esperada (nada de HTML ni enlaces arbitrarios). */
function parse(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (!data) return null;
    if (data.type !== 'message' && (typeof data.callId !== 'string' || !/^[0-9a-f-]{36}$/.test(data.callId))) return null;
    if (typeof data.conversationId !== 'string' || !/^[0-9a-f-]{36}$/.test(data.conversationId)) return null;
    return { ...data, title: String(data.title || 'Qemzagram').slice(0, 80) };
  } catch {
    return null;
  }
}

self.addEventListener('push', (event) => {
  const data = parse(event);
  if (!data) return;
  const tag = data.type === 'message' ? `chat-${data.conversationId}` : `call-${data.callId}`;
  const common = { icon: ICON, badge: ICON, tag, data: { callId: data.callId || null, conversationId: data.conversationId } };

  event.waitUntil(
    (async () => {
      if (data.type === 'message') {
        // Con la app abierta y a la vista, el mensaje ya aparece en pantalla: no hace falta el aviso.
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (windows.some((client) => client.focused || client.visibilityState === 'visible')) return;
        await self.registration.showNotification(data.title, { ...common, body: data.group ? 'Nuevo mensaje en el grupo' : 'Te mandó un mensaje', renotify: true });
        return;
      }
      if (data.type === 'call') {
        await self.registration.showNotification(data.title, {
          ...common,
          body: `${callNoun(data.kind)} entrante${data.group ? ' en el grupo' : ''}`,
          renotify: true,
          requireInteraction: true,
          vibrate: [400, 200, 400, 200, 400],
          actions: [
            { action: 'decline', title: 'Rechazar' },
            { action: 'open', title: 'Atender' },
          ],
        });
        return;
      }
      if (data.type === 'call-closed') {
        const open = await self.registration.getNotifications({ tag });
        open.forEach((notification) => notification.close());
        if (data.missed) {
          await self.registration.showNotification(data.title, { ...common, body: `${callNoun(data.kind)} perdida` });
        }
      }
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  const { callId, conversationId } = event.notification.data || {};
  event.notification.close();
  if (!conversationId) return;

  if (callId && event.action === 'decline') {
    // Misma sesión (cookie) y mismo origen que la app: la API valida todo igual que siempre.
    event.waitUntil(fetch(`/api/calls/${callId}/decline`, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined));
    return;
  }

  // Abrir (o enfocar) la app en el chat: ahí aparece la llamada para atenderla.
  const url = `/chats/${conversationId}`;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
