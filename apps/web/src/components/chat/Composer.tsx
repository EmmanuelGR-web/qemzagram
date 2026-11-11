'use client';

import { ALLOWED_FILE_EXTENSIONS, MESSAGE_MAX_LENGTH, UPLOAD_MAX_BYTES, type MessageDto, type UploadKind } from '@qemzagram/shared';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AttachIcon, CameraIcon, FileIcon, ImageIcon, SendIcon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';
import { formatBytes, kindForFile } from '@/lib/messages';

interface Props {
  conversationId: string;
  onSent: (message: MessageDto) => void;
}

const DOCUMENT_ACCEPT = ALLOWED_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',');

const PREVIEW_TITLES: Record<UploadKind, string> = { image: 'Enviar foto', video: 'Enviar video', audio: 'Enviar audio', file: 'Enviar documento' };

interface PendingFile {
  file: File;
  kind: UploadKind;
  previewUrl: string | null;
}

/** Barra para escribir: texto, adjuntos (📎) y envío. */
export function Composer({ conversationId, onSent }: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);

  async function sendText(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      onSent(await api<MessageDto>(`/chats/${conversationId}/messages`, { body: { body } }));
      setDraft('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendText();
    }
  }

  /** Se eligió un archivo: se valida el tamaño acá (el servidor lo vuelve a validar) y se muestra la vista previa. */
  function choose(file: File | undefined, forced?: UploadKind) {
    setMenuOpen(false);
    if (!file) return;
    const detected = kindForFile(file);
    // Desde "Documento" una foto o un video se mandan igual como foto/video (se ven mejor en el chat).
    const kind = forced === 'file' && detected !== 'file' ? detected : (forced ?? detected);
    if (file.size > UPLOAD_MAX_BYTES[kind]) {
      setError(`El archivo pesa ${formatBytes(file.size)}. El máximo es ${formatBytes(UPLOAD_MAX_BYTES[kind])}.`);
      return;
    }
    setError(null);
    setPending({ file, kind, previewUrl: kind === 'image' ? URL.createObjectURL(file) : null });
  }

  async function sendFile(caption: string) {
    if (!pending) return;
    const form = new FormData();
    form.append('kind', pending.kind);
    form.append('caption', caption);
    form.append('file', pending.file);
    onSent(await api<MessageDto>(`/chats/${conversationId}/attachments`, { form }));
    closePreview();
  }

  function closePreview() {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  }

  return (
    <>
      {error && (
        <p className="alert alert-error composer-error" role="alert">
          {error}
        </p>
      )}
      <form className="composer" onSubmit={sendText}>
        <div className="attach-wrap">
          <button
            type="button"
            className="icon-btn composer-btn"
            aria-label="Adjuntar"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <AttachIcon />
          </button>
          {menuOpen && (
            <div className="attach-menu" role="menu">
              <button type="button" role="menuitem" className="menu-item" onClick={() => cameraInput.current?.click()}>
                <CameraIcon /> Cámara
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => galleryInput.current?.click()}>
                <ImageIcon /> Galería
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => documentInput.current?.click()}>
                <FileIcon /> Documento
              </button>
            </div>
          )}
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribí un mensaje"
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          aria-label="Mensaje"
        />
        <button className="send-btn" disabled={sending || draft.trim().length === 0} aria-label="Enviar">
          <SendIcon />
        </button>

        {/* "capture" abre directamente la cámara en el celular; en la computadora abre el selector de archivos. */}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={galleryInput} type="file" accept="image/*" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={documentInput} type="file" accept={DOCUMENT_ACCEPT} hidden onChange={(event) => { choose(event.target.files?.[0], 'file'); event.target.value = ''; }} />
      </form>

      {pending && <AttachmentPreview pending={pending} onCancel={closePreview} onSend={sendFile} />}
    </>
  );
}

/** Vista previa antes de enviar, con epígrafe opcional. */
function AttachmentPreview(props: { pending: PendingFile; onCancel: () => void; onSend: (caption: string) => Promise<void> }) {
  const { pending, onCancel, onSend } = props;
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [pending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSend(caption.trim());
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Modal title={PREVIEW_TITLES[pending.kind]} onClose={busy ? () => undefined : onCancel}>
      <form onSubmit={submit} className="form">
        {pending.kind === 'image' && pending.previewUrl && <img className="attach-preview" src={pending.previewUrl} alt="Vista previa" />}
        {pending.kind === 'file' && (
          <div className="file-chip">
            <span className="file-chip-icon"><FileIcon /></span>
            <span className="file-chip-body">
              <strong>{pending.file.name}</strong>
              <small>{formatBytes(pending.file.size)}</small>
            </span>
          </div>
        )}
        <input value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Agregá un comentario (opcional)" maxLength={MESSAGE_MAX_LENGTH} aria-label="Comentario" />
        {error && <p className="alert alert-error">{error}</p>}
        <div className="button-row">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
