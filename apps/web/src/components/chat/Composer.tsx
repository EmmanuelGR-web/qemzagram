'use client';

import { ALLOWED_FILE_EXTENSIONS, MESSAGE_MAX_LENGTH, UPLOAD_MAX_BYTES, VIDEO_MAX_SECONDS, VOICE_MAX_SECONDS, type MessageDto, type UploadKind } from '@qemzagram/shared';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AttachIcon, CameraIcon, FileIcon, ImageIcon, MicIcon, SendIcon, StickerIcon, TrashIcon, VideoIcon } from '@/components/icons';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';
import { useAttachmentSender, useMessageSender } from '@/lib/e2ee-messages';
import { sanitizeDocument, sanitizeImage, sanitizeMedia, type SanitizedFile } from '@/lib/media-sanitize';
import { formatBytes, formatDuration, kindForFile } from '@/lib/messages';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { CameraCapture, cameraSupported } from './CameraCapture';
import { StickerPicker } from './StickerPicker';

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
  const [stickersOpen, setStickersOpen] = useState(false);
  const [camera, setCamera] = useState<'photo' | 'video' | null>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const voice = useVoiceRecorder();
  const recording = voice.state === 'recording';
  const sendMessage = useMessageSender(conversationId);
  const sendAttachment = useAttachmentSender(conversationId);

  async function sendText(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      onSent(await sendMessage({ t: 'text', body }, () => api<MessageDto>(`/chats/${conversationId}/messages`, { body: { body } })));
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
    setPending({ file, kind, previewUrl: kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : null });
  }

  async function sendFile(caption: string) {
    if (!pending) return;
    const { file, kind } = pending;
    const legacy = () => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('caption', caption);
      form.append('file', file);
      return api<MessageDto>(`/chats/${conversationId}/attachments`, { form });
    };
    onSent(await sendAttachment(() => prepareFile(file, kind), caption, legacy));
    closePreview();
  }

  /** Termina la grabación y la envía como nota de voz (el servidor la convierte y le quita metadatos). */
  async function sendVoice() {
    const recordedMs = voice.seconds * 1000;
    const result = await voice.stop();
    if (!result) return;
    setSending(true);
    setError(null);
    try {
      const legacy = () => {
        const form = new FormData();
        form.append('kind', 'audio');
        form.append('file', new File([result.blob], result.fileName, { type: result.blob.type }));
        return api<MessageDto>(`/chats/${conversationId}/attachments`, { form });
      };
      onSent(await sendAttachment(() => sanitizeMedia(result.blob, 'audio', recordedMs), '', legacy));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSending(false);
    }
  }

  // Al llegar a la duración máxima, la nota se envía sola.
  useEffect(() => {
    if (recording && voice.seconds >= VOICE_MAX_SECONDS) void sendVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, voice.seconds]);

  /** Cámara dentro de la app; si el navegador no lo permite (p. ej. sin HTTPS), selector de archivos. */
  function openCamera(mode: 'photo' | 'video') {
    setMenuOpen(false);
    if (cameraSupported()) setCamera(mode);
    else (mode === 'photo' ? cameraInput : videoInput).current?.click();
  }

  function closePreview() {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
  }

  return (
    <>
      {(error ?? voice.error) && (
        <p className="alert alert-error composer-error" role="alert">
          {error ?? voice.error}
        </p>
      )}
      <form className="composer" onSubmit={sendText}>
        {recording ? (
          <div className="recording-bar" role="status">
            <button type="button" className="icon-btn composer-btn" onClick={voice.cancel} aria-label="Descartar grabación">
              <TrashIcon />
            </button>
            <span className="recording-dot" aria-hidden="true" />
            <span className="recording-time">{formatDuration(voice.seconds * 1000)}</span>
            <span className="muted small">Grabando… (máx. {VOICE_MAX_SECONDS / 60} min)</span>
            <button type="button" className="send-btn" onClick={() => void sendVoice()} aria-label="Enviar nota de voz">
              <SendIcon />
            </button>
          </div>
        ) : (
          <>
            <div className="attach-wrap">
              <button
                type="button"
                className="icon-btn composer-btn"
                aria-label="Adjuntar"
                aria-expanded={menuOpen}
                onClick={() => {
                  setStickersOpen(false);
                  setMenuOpen((open) => !open);
                }}
              >
                <AttachIcon />
              </button>
              {menuOpen && (
                <div className="attach-menu" role="menu">
                  <button type="button" role="menuitem" className="menu-item" onClick={() => openCamera('photo')}>
                    <CameraIcon /> Cámara
                  </button>
                  <button type="button" role="menuitem" className="menu-item" onClick={() => openCamera('video')}>
                    <VideoIcon /> Video
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
            <div className="attach-wrap">
              <button
                type="button"
                className="icon-btn composer-btn"
                aria-label="Stickers"
                aria-expanded={stickersOpen}
                data-sticker-toggle
                onClick={() => {
                  setMenuOpen(false);
                  setStickersOpen((open) => !open);
                }}
              >
                <StickerIcon />
              </button>
              {stickersOpen && <StickerPicker conversationId={conversationId} onSent={onSent} onClose={() => setStickersOpen(false)} />}
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
            {/* Sin texto, el botón graba una nota de voz (como en las apps de mensajería). */}
            {draft.trim().length > 0 ? (
              <button className="send-btn" disabled={sending} aria-label="Enviar">
                <SendIcon />
              </button>
            ) : (
              <button type="button" className="send-btn" onClick={() => void voice.start()} disabled={sending} aria-label="Grabar nota de voz">
                <MicIcon />
              </button>
            )}
          </>
        )}

        {/* "capture" abre directamente la cámara en el celular; en la computadora abre el selector de archivos. */}
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={videoInput} type="file" accept="video/*" capture="environment" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={galleryInput} type="file" accept="image/*,video/*" hidden onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} />
        <input ref={documentInput} type="file" accept={DOCUMENT_ACCEPT} hidden onChange={(event) => { choose(event.target.files?.[0], 'file'); event.target.value = ''; }} />
      </form>

      {camera && (
        <CameraCapture
          mode={camera}
          onClose={() => setCamera(null)}
          onCapture={(file) => {
            setCamera(null);
            choose(file);
          }}
          onFallback={() => {
            const mode = camera;
            setCamera(null);
            (mode === 'photo' ? cameraInput : videoInput).current?.click();
          }}
        />
      )}
      {pending && <AttachmentPreview pending={pending} onCancel={closePreview} onSend={sendFile} />}
    </>
  );
}

/** Limpieza en el dispositivo según el tipo (solo para chats de extremo a extremo). */
function prepareFile(file: File, kind: UploadKind): Promise<SanitizedFile> {
  if (kind === 'image') return sanitizeImage(file, 'image');
  if (kind === 'video' || kind === 'audio') return sanitizeMedia(file, kind);
  return sanitizeDocument(file);
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
        {pending.kind === 'video' && pending.previewUrl && <video className="attach-preview" src={pending.previewUrl} controls playsInline />}
        {pending.kind === 'video' && <p className="hint">Máximo {VIDEO_MAX_SECONDS / 60} minutos. El video se procesa al enviarlo y puede tardar unos segundos.</p>}
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
