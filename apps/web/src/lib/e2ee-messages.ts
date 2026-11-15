'use client';

import {
  E2eeError,
  encryptFile,
  keyFingerprint,
  openMessage,
  sealMessage,
  type ConversationKeysDto,
  type E2eeContent,
  type E2eeFileRef,
  type E2eeKeyDto,
  type MessageDto,
  type OpenedMessage,
  type Recipient,
} from '@qemzagram/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, UserFacingError } from './api';
import { useE2ee } from './e2ee-context';
import { loadSeenKey, saveSeenKey, type DeviceKey } from './e2ee-store';
import type { SanitizedFile } from './media-sanitize';
import { messagePreview } from './messages';

/**
 * Cómo se ve un mensaje en ESTE dispositivo:
 * - `server`: mensaje viejo o de un chat sin cifrado de extremo a extremo (lo cifra el servidor).
 * - `e2ee`: descifrado y verificado acá.
 * - `pending`: descifrando. `locked`: falta el código de recuperación en este dispositivo.
 * - `old-key`: se cifró para claves que ya no existen. `failed`: alterado o de un remitente que no coincide.
 */
export type Secure = 'server' | 'e2ee' | 'pending' | 'locked' | 'old-key' | 'failed';

export interface ViewMessage extends MessageDto {
  secure: Secure;
  /** Para denunciar un mensaje cifrado: contenido exacto + clave de franqueo. */
  reveal: OpenedMessage['reveal'] | null;
  /** Adjunto cifrado de extremo a extremo (clave y datos del archivo). */
  file: E2eeFileRef | null;
}

type Outcome = { ok: true; opened: OpenedMessage } | { ok: false; reason: 'failed' | 'old-key' };

/** Caché en memoria de mensajes ya abiertos (se comparte entre la lista de chats y la conversación). */
const outcomes = new Map<string, Outcome>();
const cacheKey = (device: DeviceKey, messageId: string) => `${device.userId}:${device.keyId}:${messageId}`;

async function openOne(message: MessageDto, device: DeviceKey, keys: Map<string, E2eeKeyDto>): Promise<Outcome> {
  if (!message.e2ee) return { ok: false, reason: 'failed' };
  const senderKey = keys.get(message.e2ee.envelope.sk);
  // La clave tiene que ser DE quien figura como remitente (si no, el servidor podría hacerse pasar por otra persona).
  if (!senderKey || senderKey.userId !== message.senderId) return { ok: false, reason: 'failed' };
  try {
    const opened = await openMessage(
      message.e2ee.envelope,
      message.e2ee.commitment,
      { conversationId: message.conversationId, objectId: message.id, senderId: message.senderId },
      { userId: device.userId, keyId: device.keyId, privateKey: device.privateKey },
      senderKey.publicKey,
    );
    return { ok: true, opened };
  } catch (error) {
    const oldKey = error instanceof E2eeError && (error.code === 'OTHER_KEY' || error.code === 'NOT_FOR_ME');
    return { ok: false, reason: oldKey ? 'old-key' : 'failed' };
  }
}

function toView(message: MessageDto, device: DeviceKey | null): ViewMessage {
  const base: ViewMessage = { ...message, secure: 'server', reveal: null, file: null };
  if (!message.e2ee) return base;
  if (!device) return { ...base, secure: 'locked' };
  const outcome = outcomes.get(cacheKey(device, message.id));
  if (!outcome) return { ...base, secure: 'pending' };
  if (!outcome.ok) return { ...base, secure: outcome.reason };
  const { content, reveal } = outcome.opened;
  const view: ViewMessage = { ...base, secure: 'e2ee', reveal };
  if (content.t === 'text') return { ...view, body: content.body };
  if (content.t === 'sticker') return { ...view, sticker: content.code };
  return { ...view, body: content.body, file: content.file };
}

/** Descifra (en el navegador) los mensajes cifrados de la lista. Los demás pasan tal cual. */
export function useViewMessages(messages: MessageDto[]): ViewMessage[] {
  const { device, keysById } = useE2ee();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!device) return;
    const pending = messages.filter((message) => message.e2ee && !outcomes.has(cacheKey(device, message.id)));
    if (pending.length === 0) return;
    void (async () => {
      const keys = await keysById(pending.flatMap((message) => (message.e2ee ? [message.e2ee.envelope.sk] : []))).catch(() => new Map<string, E2eeKeyDto>());
      for (const message of pending) outcomes.set(cacheKey(device, message.id), await openOne(message, device, keys));
      // Siempre (aunque el efecto se haya reemplazado): así la vista nunca queda con datos viejos.
      setVersion((value) => value + 1);
    })();
  }, [messages, device, keysById]);

  return useMemo(
    () => messages.map((message) => toView(message, device)),
    // `version` cambia cuando terminan de abrirse mensajes nuevos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, device, version],
  );
}

/** Texto corto para la lista de chats, también para mensajes que todavía no se pueden mostrar. */
export function viewPreview(message: ViewMessage): string {
  switch (message.secure) {
    case 'pending':
      return '🔒 Mensaje cifrado';
    case 'locked':
      return '🔒 Mensaje cifrado (falta tu código)';
    case 'old-key':
    case 'failed':
      return '⚠️ Mensaje no disponible';
    default:
      return message.file ? filePreview(message) : messagePreview(message);
  }
}

function filePreview(message: ViewMessage): string {
  const caption = message.body.trim();
  switch (message.file?.kind) {
    case 'image':
      return caption ? `📷 ${caption}` : '📷 Foto';
    case 'video':
      return caption ? `🎬 ${caption}` : '🎬 Video';
    case 'audio':
      return '🎤 Nota de voz';
    case 'sticker':
      return 'Sticker';
    default:
      return `📎 ${message.file?.name ?? 'Archivo'}`;
  }
}

/** Error que se muestra si el chat es de extremo a extremo pero este dispositivo no tiene la clave. */
export const e2eeLockedError = () =>
  new ApiError(409, 'E2EE_LOCKED', 'Este chat está cifrado de extremo a extremo. Ingresá tu código de recuperación (Ajustes → Seguridad) para escribir.');

/**
 * Decide cómo enviar en este chat: si TODOS los miembros activaron el cifrado, se cifra en el
 * dispositivo; si no, se usa el envío de siempre (cifrado en el servidor).
 */
export function useSendPlanner(conversationId: string) {
  const { device } = useE2ee();
  return useCallback(async (): Promise<{ recipients: Recipient[]; device: DeviceKey } | null> => {
    const keys = await api<ConversationKeysDto>(`/e2ee/conversations/${conversationId}/keys`);
    if (!keys.members.every((member) => member.key)) return null;
    const mine = keys.members.find((member) => member.userId === device?.userId);
    if (!device || mine?.key?.id !== device.keyId) throw e2eeLockedError();
    return {
      device,
      recipients: keys.members.flatMap((member) => (member.key ? [{ userId: member.userId, keyId: member.key.id, publicJwk: member.key.publicKey }] : [])),
    };
  }, [conversationId, device]);
}

/** Envía texto o un sticker del pack: cifrado si el chat lo permite, o con `legacy()` si no. */
export function useMessageSender(conversationId: string) {
  const plan = useSendPlanner(conversationId);
  return useCallback(
    async (content: Exclude<E2eeContent, { t: 'file' }>, legacy: () => Promise<MessageDto>): Promise<MessageDto> => {
      for (let attempt = 0; ; attempt++) {
        const planned = await plan();
        if (!planned) return legacy();
        const id = crypto.randomUUID();
        const sealed = await sealMessage(content, { conversationId, objectId: id, senderId: planned.device.userId }, planned.device, planned.recipients);
        try {
          return await api<MessageDto>(`/chats/${conversationId}/e2ee/messages`, { body: { id, envelope: sealed.envelope, commitment: sealed.commitment } });
        } catch (error) {
          // Alguien entró, salió o cambió sus claves justo ahora: se vuelven a pedir y se cifra de nuevo (una vez).
          if (!(error instanceof ApiError && error.code === 'E2EE_KEYS_CHANGED') || attempt > 0) throw error;
        }
      }
    },
    [conversationId, plan],
  );
}

/**
 * Envía un archivo: si el chat es de extremo a extremo, `prepare()` lo limpia en el dispositivo, se cifra
 * con una clave nueva y la clave viaja DENTRO del mensaje cifrado. Si no, se usa `legacy()` (el servidor
 * valida, escanea y recodifica como siempre).
 */
export function useAttachmentSender(conversationId: string) {
  const plan = useSendPlanner(conversationId);
  return useCallback(
    async (prepare: () => Promise<SanitizedFile>, caption: string, legacy: () => Promise<MessageDto>): Promise<MessageDto> => {
      let planned = await plan();
      if (!planned) return legacy();
      const sanitized = await prepare();
      const id = crypto.randomUUID();
      const attachmentId = crypto.randomUUID();
      const encrypted = await encryptFile(sanitized.data, attachmentId);
      const content: E2eeContent = { t: 'file', body: caption, file: { ...sanitized.meta, id: attachmentId, key: encrypted.key, size: sanitized.data.length } };
      for (let attempt = 0; ; attempt++) {
        let sealed;
        try {
          sealed = await sealMessage(content, { conversationId, objectId: id, senderId: planned.device.userId }, planned.device, planned.recipients);
        } catch {
          throw new UserFacingError('No pudimos preparar este archivo para enviarlo cifrado.');
        }
        const form = new FormData();
        form.append('meta', JSON.stringify({ id, attachmentId, envelope: sealed.envelope, commitment: sealed.commitment }));
        form.append('file', new Blob([encrypted.blob], { type: 'application/octet-stream' }), 'cifrado.bin');
        try {
          return await api<MessageDto>(`/chats/${conversationId}/e2ee/attachments`, { form });
        } catch (error) {
          if (!(error instanceof ApiError && error.code === 'E2EE_KEYS_CHANGED') || attempt > 0) throw error;
          const next = await plan();
          if (!next) throw error;
          planned = next;
        }
      }
    },
    [conversationId, plan],
  );
}

/**
 * Claves de los miembros de un chat, sus códigos de seguridad y si alguna CAMBIÓ desde la última vez
 * (puede ser un dispositivo nuevo… o alguien haciéndose pasar por esa persona).
 */
export function useConversationKeys(conversationId: string, memberIds: string) {
  const { device } = useE2ee();
  const [keys, setKeys] = useState<ConversationKeysDto | null>(null);
  const [fingerprints, setFingerprints] = useState<Map<string, string>>(new Map());
  const [changed, setChanged] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    setChanged([]);
    void (async () => {
      const loaded = await api<ConversationKeysDto>(`/e2ee/conversations/${conversationId}/keys`).catch(() => null);
      if (!active || !loaded) return;
      setKeys(loaded);
      const prints = new Map<string, string>();
      const different: string[] = [];
      for (const member of loaded.members) {
        if (!member.key) continue;
        prints.set(member.userId, await keyFingerprint(member.key.publicKey));
        if (!device || member.userId === device.userId) continue;
        const seen = await loadSeenKey(device.userId, member.userId).catch(() => null);
        if (seen && seen !== member.key.id) different.push(member.userId);
        await saveSeenKey(device.userId, member.userId, member.key.id).catch(() => undefined);
      }
      if (!active) return;
      setFingerprints(prints);
      setChanged(different);
    })();
    return () => {
      active = false;
    };
  }, [conversationId, memberIds, device]);

  const complete = keys !== null && keys.members.every((member) => member.key);
  const dismissChanged = useCallback(() => setChanged([]), []);
  return { complete, fingerprints, changed, dismissChanged };
}
