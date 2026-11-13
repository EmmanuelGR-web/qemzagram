'use client';

import { STATUS_TEXT_MAX_LENGTH, STATUS_VIDEO_MAX_SECONDS, UPLOAD_MAX_BYTES, type StatusDto, type StatusMediaKind } from '@qemzagram/shared';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';

/**
 * Sugerencia de la interfaz: el SERVIDOR vuelve a validar el contenido real y rechaza lo que no coincida.
 * `null` = no es ni foto ni video.
 */
export function statusKindForFile(file: File): StatusMediaKind | null {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return null;
}

/** Vista previa + epígrafe de la foto o video elegido, y publicación. */
export function MediaStatusEditor({ file, onClose, onCreated }: { file: File; onClose: () => void; onCreated: (status: StatusDto) => void }) {
  const kind = statusKindForFile(file);
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (!kind) return 'Elegí una foto o un video.';
    if (file.size > UPLOAD_MAX_BYTES[kind]) return `El archivo supera el máximo de ${UPLOAD_MAX_BYTES[kind] / 1024 / 1024} MB.`;
    return null;
  });

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!kind) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('kind', kind);
    form.append('caption', caption);
    form.append('file', file);
    try {
      onCreated(await api<StatusDto>('/statuses/media', { form }));
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Modal title={kind === 'video' ? 'Estado con video' : 'Estado con foto'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        {kind && (
          <div className="status-media-preview">
            {kind === 'image' ? <img src={previewUrl} alt="Vista previa" /> : <video src={previewUrl} controls playsInline muted />}
          </div>
        )}
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder="Agregá un comentario (opcional)"
          maxLength={STATUS_TEXT_MAX_LENGTH}
          aria-label="Comentario"
        />
        <p className="hint">
          Se quitan los metadatos (ubicación, cámara) antes de guardarlo.
          {kind === 'video' && ` Los videos de estado duran hasta ${STATUS_VIDEO_MAX_SECONDS} segundos.`}
        </p>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || !kind}>
          {busy ? 'Publicando…' : 'Publicar'}
        </button>
      </form>
    </Modal>
  );
}
