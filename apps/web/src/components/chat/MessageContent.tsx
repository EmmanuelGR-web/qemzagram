'use client';

import { decryptFile, GENERAL_STICKER_LABELS, type AttachmentDto, type E2eeFileRef } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { CloseIcon, DownloadIcon, FileIcon, MicIcon, PhoneIcon, VideoIcon } from '@/components/icons';
import { mediaUrl } from '@/lib/api';
import type { ViewMessage } from '@/lib/e2ee-messages';
import { callLabel, formatBytes, formatDuration } from '@/lib/messages';

interface Props {
  message: ViewMessage;
  /** Se llama si un archivo no carga (URL vencida o sesión vencida): la página renueva las URLs. */
  onMediaError: () => void;
}

/** Contenido de una burbuja: adjunto (si hay) + texto o epígrafe. */
export function MessageContent({ message, onMediaError }: Props) {
  const { attachment } = message;
  if (message.call) {
    const missed = message.call.endReason !== 'completed';
    return (
      <span className="call-log" data-missed={missed}>
        <span className="call-log-icon">{message.call.kind === 'video' ? <VideoIcon /> : <PhoneIcon />}</span>
        <span>{callLabel(message.call)}</span>
      </span>
    );
  }
  switch (message.secure) {
    case 'pending':
      return <span className="bubble-text muted">🔒 Descifrando…</span>;
    case 'locked':
      return <span className="bubble-text muted">🔒 Mensaje cifrado. Ingresá tu código de recuperación (Ajustes → Seguridad) para verlo.</span>;
    case 'old-key':
      return <span className="bubble-text muted">🔒 Este mensaje se cifró para claves anteriores y ya no se puede leer.</span>;
    case 'failed':
      return <span className="bubble-text muted">⚠️ No pudimos verificar este mensaje: puede haber sido alterado.</span>;
    default:
      break;
  }
  if (message.sticker) {
    return <img className="sticker-img" src={`/stickers/${message.sticker}.svg`} alt={`Sticker: ${GENERAL_STICKER_LABELS[message.sticker]}`} />;
  }
  return (
    <>
      {message.secure === 'e2ee' && message.file ? (
        <E2eeAttachment file={message.file} attachment={attachment} onMediaError={onMediaError} />
      ) : (
        attachment && !attachment.e2ee && <AttachmentView attachment={attachment} src={mediaUrl(attachment.url) ?? ''} onMediaError={onMediaError} />
      )}
      {message.body && <span className="bubble-text">{message.body}</span>}
    </>
  );
}

/* ---------- Adjuntos cifrados de extremo a extremo ---------- */

/** Archivos ya descifrados en esta pestaña (id del adjunto → URL local `blob:`). */
const decrypted = new Map<string, string>();
const DECRYPTED_MAX = 60;

/** Baja los bytes cifrados, los descifra EN EL NAVEGADOR y devuelve una URL local (nunca sale del dispositivo). */
async function decryptToUrl(attachment: AttachmentDto, file: E2eeFileRef): Promise<string> {
  const cached = decrypted.get(attachment.id);
  if (cached) return cached;
  const response = await fetch(mediaUrl(attachment.url) ?? '', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('No se pudo descargar');
  const plain = await decryptFile(new Uint8Array(await response.arrayBuffer()), file.key, attachment.id);
  if (plain.length !== file.size) throw new Error('Tamaño inesperado');
  // Los documentos nunca se abren dentro de la app: siempre como descarga.
  const url = URL.createObjectURL(new Blob([plain], { type: file.kind === 'file' ? 'application/octet-stream' : file.mime }));
  decrypted.set(attachment.id, url);
  if (decrypted.size > DECRYPTED_MAX) {
    const [oldest] = decrypted.keys();
    if (oldest) {
      URL.revokeObjectURL(decrypted.get(oldest) ?? '');
      decrypted.delete(oldest);
    }
  }
  return url;
}

function E2eeAttachment({ file, attachment, onMediaError }: { file: E2eeFileRef; attachment: AttachmentDto | null; onMediaError: () => void }) {
  // El archivo tiene que ser EL de este mensaje (el id también está atado al cifrado del archivo).
  if (!attachment?.e2ee || attachment.id !== file.id) return <span className="bubble-text muted">⚠️ Adjunto no disponible</span>;
  return file.kind === 'file' ? <E2eeDocument file={file} attachment={attachment} onMediaError={onMediaError} /> : <E2eeInline file={file} attachment={attachment} onMediaError={onMediaError} />;
}

/** Vista que el resto de la burbuja ya sabe mostrar, con los datos que venían DENTRO del mensaje cifrado. */
const asAttachment = (attachment: AttachmentDto, file: E2eeFileRef): AttachmentDto => ({
  ...attachment,
  kind: file.kind,
  mimeType: file.mime,
  size: file.size,
  name: file.name,
  width: file.w,
  height: file.h,
  durationMs: file.dur,
});

function E2eeInline({ file, attachment, onMediaError }: { file: E2eeFileRef; attachment: AttachmentDto; onMediaError: () => void }) {
  const [src, setSrc] = useState<string | null>(() => decrypted.get(attachment.id) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    decryptToUrl(attachment, file).then(
      (url) => active && setSrc(url),
      () => {
        if (!active) return;
        setFailed(true);
        // Puede haber vencido la URL firmada: la página pide los mensajes de nuevo (con URLs nuevas).
        onMediaError();
      },
    );
    return () => {
      active = false;
    };
  }, [attachment, file, onMediaError]);

  if (failed) return <span className="bubble-text muted">⚠️ No pudimos abrir este archivo</span>;
  if (!src) return <span className="bubble-text muted">🔒 Descifrando…</span>;
  return <AttachmentView attachment={asAttachment(attachment, file)} src={src} onMediaError={() => setFailed(true)} />;
}

/** Documento cifrado: se descifra recién al tocar "descargar". */
function E2eeDocument({ file, attachment, onMediaError }: { file: E2eeFileRef; attachment: AttachmentDto; onMediaError: () => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const extension = file.name?.split('.').pop()?.toUpperCase() ?? '';

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const link = document.createElement('a');
      link.href = await decryptToUrl(attachment, file);
      link.download = file.name ?? 'archivo';
      link.rel = 'noopener';
      link.click();
    } catch {
      setFailed(true);
      onMediaError();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="file-chip file-chip-link" onClick={() => void download()} disabled={busy}>
      <span className="file-chip-icon"><FileIcon /></span>
      <span className="file-chip-body">
        <strong>{file.name ?? 'Archivo'}</strong>
        <small>
          {failed ? 'No se pudo descargar. Probá de nuevo.' : `${extension ? `${extension} · ` : ''}${formatBytes(file.size)}`}
        </small>
      </span>
      <span className="file-chip-action" aria-label="Descargar"><DownloadIcon /></span>
    </button>
  );
}

function AttachmentView({ attachment, src, onMediaError }: { attachment: AttachmentDto; src: string; onMediaError: () => void }) {
  switch (attachment.kind) {
    case 'image':
      return <ImageAttachment src={src} attachment={attachment} onMediaError={onMediaError} />;
    case 'sticker':
      return <img className="sticker-img" src={src} alt="Sticker" loading="lazy" onError={onMediaError} />;
    case 'file':
      return <FileAttachment src={src} attachment={attachment} />;
    case 'video':
      return (
        <span className="bubble-media bubble-video">
          {/* preload="metadata": solo baja la duración y el primer cuadro hasta que se aprieta play. */}
          <video
            src={src}
            controls
            playsInline
            preload="metadata"
            width={attachment.width ?? undefined}
            height={attachment.height ?? undefined}
            onError={onMediaError}
            aria-label={`Video de ${formatDuration(attachment.durationMs)}`}
          />
        </span>
      );
    case 'audio':
      return (
        <span className="voice-note">
          <MicIcon />
          {/* Reproductor nativo: accesible y con soporte de adelantar (el servidor sirve rangos). */}
          <audio src={src} controls preload="metadata" onError={onMediaError} aria-label={`Nota de voz de ${formatDuration(attachment.durationMs)}`} />
        </span>
      );
    default:
      return <span className="bubble-text muted">Adjunto no compatible con esta versión</span>;
  }
}

function ImageAttachment({ src, attachment, onMediaError }: { src: string; attachment: AttachmentDto; onMediaError: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="bubble-media" onClick={() => setOpen(true)} aria-label="Ver foto completa">
        <img
          src={src}
          alt="Foto"
          width={attachment.width ?? undefined}
          height={attachment.height ?? undefined}
          loading="lazy"
          decoding="async"
          onError={onMediaError}
        />
      </button>
      {open && <Lightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Documento: tarjeta con nombre y tamaño; el servidor fuerza la descarga (nunca se abre dentro de la app). */
function FileAttachment({ src, attachment }: { src: string; attachment: AttachmentDto }) {
  const extension = attachment.name?.split('.').pop()?.toUpperCase() ?? '';
  return (
    <a className="file-chip file-chip-link" href={src} download={attachment.name ?? true} rel="noopener">
      <span className="file-chip-icon"><FileIcon /></span>
      <span className="file-chip-body">
        <strong>{attachment.name ?? 'Archivo'}</strong>
        <small>
          {extension && `${extension} · `}
          {formatBytes(attachment.size)}
        </small>
      </span>
      <span className="file-chip-action" aria-label="Descargar"><DownloadIcon /></span>
    </a>
  );
}

/** Visor a pantalla completa (Esc o tocar afuera para cerrar). */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Foto" onClick={onClose}>
      <button type="button" className="icon-btn lightbox-close" onClick={onClose} aria-label="Cerrar">
        <CloseIcon />
      </button>
      <img src={src} alt="Foto en tamaño completo" onClick={(event) => event.stopPropagation()} />
    </div>
  );
}
