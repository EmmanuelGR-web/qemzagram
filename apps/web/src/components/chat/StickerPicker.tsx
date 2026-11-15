'use client';

import {
  CUSTOM_STICKERS_MAX,
  GENERAL_STICKER_CODES,
  GENERAL_STICKER_LABELS,
  STICKER_UPLOAD_MAX_BYTES,
  type MessageDto,
  type SendStickerInput,
  type StickerDto,
} from '@qemzagram/shared';
import { useEffect, useRef, useState } from 'react';
import { PlusIcon, TrashIcon } from '@/components/icons';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { useAttachmentSender, useMessageSender } from '@/lib/e2ee-messages';
import { sanitizeImage } from '@/lib/media-sanitize';
import { formatBytes } from '@/lib/messages';

interface Props {
  conversationId: string;
  onSent: (message: MessageDto) => void;
  onClose: () => void;
}

type Tab = 'general' | 'mine';

/** Selector de stickers: pack general de Qemzagram y "Mis stickers" (crear, enviar y borrar). */
export function StickerPicker({ conversationId, onSent, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general');
  const [mine, setMine] = useState<StickerDto[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const sendMessage = useMessageSender(conversationId);
  const sendAttachment = useAttachmentSender(conversationId);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lastReload = useRef(0);

  /** Si una imagen no carga (URL o sesión vencida), se piden URLs nuevas. Como mucho cada 30 s. */
  function reloadMine() {
    if (Date.now() - lastReload.current < 30_000) return;
    lastReload.current = Date.now();
    setMine(null);
  }

  // Cerrar con Escape o tocando fuera del panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!panel.current?.contains(target) && !target.closest('[data-sticker-toggle]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  useEffect(() => {
    if (tab !== 'mine' || mine !== null) return;
    api<StickerDto[]>('/stickers')
      .then(setMine)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, [tab, mine]);

  /** Sticker propio en un chat cifrado: se descarga de "Mis stickers" y viaja cifrado como imagen. */
  async function prepareOwnSticker(stickerId: string) {
    const sticker = mine?.find((item) => item.id === stickerId);
    const response = sticker ? await fetch(mediaUrl(sticker.url) ?? '', { credentials: 'same-origin' }) : null;
    if (!response?.ok) throw new Error('No se pudo leer el sticker');
    return sanitizeImage(await response.blob(), 'sticker');
  }

  async function send(input: SendStickerInput) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const legacy = () => api<MessageDto>(`/chats/${conversationId}/stickers`, { body: input });
      onSent('code' in input ? await sendMessage({ t: 'sticker', code: input.code }, legacy) : await sendAttachment(() => prepareOwnSticker(input.stickerId), '', legacy));
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function create(file: File | undefined) {
    if (!file) return;
    if (file.size > STICKER_UPLOAD_MAX_BYTES) {
      setError(`La imagen pesa ${formatBytes(file.size)}. El máximo es ${formatBytes(STICKER_UPLOAD_MAX_BYTES)}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const created = await api<StickerDto>('/stickers', { form });
      setMine((current) => [created, ...(current ?? [])]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function remove(sticker: StickerDto) {
    if (!window.confirm('¿Borrar este sticker de tu colección? Los mensajes ya enviados no se modifican.')) return;
    try {
      await api(`/stickers/${sticker.id}`, { method: 'DELETE' });
      setMine((current) => (current ?? []).filter((item) => item.id !== sticker.id));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="sticker-picker" ref={panel} role="dialog" aria-label="Stickers">
      <div className="sticker-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'general'} onClick={() => setTab('general')}>
          Qemzagram
        </button>
        <button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>
          Mis stickers
        </button>
        {tab === 'mine' && (mine?.length ?? 0) > 0 && (
          <button type="button" className="sticker-edit" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Listo' : 'Editar'}
          </button>
        )}
      </div>

      {error && <p className="alert alert-error sticker-error">{error}</p>}

      {tab === 'general' ? (
        <div className="sticker-grid">
          {GENERAL_STICKER_CODES.map((code) => (
            <button key={code} type="button" className="sticker-cell" disabled={busy} onClick={() => void send({ code })} title={GENERAL_STICKER_LABELS[code]}>
              <img src={`/stickers/${code}.svg`} alt={GENERAL_STICKER_LABELS[code]} loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        <div className="sticker-grid">
          <button
            type="button"
            className="sticker-cell sticker-add"
            disabled={busy || (mine?.length ?? 0) >= CUSTOM_STICKERS_MAX}
            onClick={() => fileInput.current?.click()}
            aria-label="Crear sticker desde una imagen"
          >
            <PlusIcon />
            <small>{busy ? 'Creando…' : 'Crear'}</small>
          </button>
          {mine === null && <p className="muted small sticker-hint">Cargando…</p>}
          {mine?.map((sticker) => (
            <div key={sticker.id} className="sticker-cell-wrap">
              <button type="button" className="sticker-cell" disabled={busy || editing} onClick={() => void send({ stickerId: sticker.id })}>
                <img src={mediaUrl(sticker.url) ?? ''} alt="Sticker propio" loading="lazy" onError={reloadMine} />
              </button>
              {editing && (
                <button type="button" className="sticker-delete" onClick={() => void remove(sticker)} aria-label="Borrar sticker">
                  <TrashIcon />
                </button>
              )}
            </div>
          ))}
          {mine?.length === 0 && <p className="muted small sticker-hint">Creá stickers con tus fotos: se recortan a 512×512 y solo vos los ves en tu colección.</p>}
        </div>
      )}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => { void create(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
  );
}
