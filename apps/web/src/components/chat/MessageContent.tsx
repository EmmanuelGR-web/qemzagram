'use client';

import type { AttachmentDto, MessageDto } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { CloseIcon } from '@/components/icons';
import { mediaUrl } from '@/lib/api';

interface Props {
  message: MessageDto;
  /** Se llama si un archivo no carga (URL vencida o sesión vencida): la página renueva las URLs. */
  onMediaError: () => void;
}

/** Contenido de una burbuja: adjunto (si hay) + texto o epígrafe. */
export function MessageContent({ message, onMediaError }: Props) {
  const { attachment } = message;
  return (
    <>
      {attachment && <AttachmentView attachment={attachment} onMediaError={onMediaError} />}
      {message.body && <span className="bubble-text">{message.body}</span>}
    </>
  );
}

function AttachmentView({ attachment, onMediaError }: { attachment: AttachmentDto; onMediaError: () => void }) {
  const src = mediaUrl(attachment.url) ?? '';
  switch (attachment.kind) {
    case 'image':
      return <ImageAttachment src={src} attachment={attachment} onMediaError={onMediaError} />;
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
