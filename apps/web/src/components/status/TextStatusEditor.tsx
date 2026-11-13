'use client';

import { STATUS_TEXT_MAX_LENGTH, type StatusBackground, type StatusDto } from '@qemzagram/shared';
import { useState, type FormEvent } from 'react';
import { Modal } from '@/components/Modal';
import { api, errorMessage } from '@/lib/api';
import { STATUS_BACKGROUND_OPTIONS } from '@/lib/statuses';

export function TextStatusEditor({ onClose, onCreated }: { onClose: () => void; onCreated: (status: StatusDto) => void }) {
  const [body, setBody] = useState('');
  const [background, setBackground] = useState<StatusBackground>('rojo');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api<StatusDto>('/statuses/text', { body: { body, background } }));
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <Modal title="Estado de texto" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="status-bg status-editor-preview" data-bg={background}>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="¿Qué querés contar?"
            maxLength={STATUS_TEXT_MAX_LENGTH}
            aria-label="Texto del estado"
            autoFocus
          />
        </div>
        <div className="status-swatches" role="radiogroup" aria-label="Fondo">
          {STATUS_BACKGROUND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              className="status-bg"
              data-bg={option.value}
              aria-checked={background === option.value}
              aria-label={option.label}
              title={option.label}
              onClick={() => setBackground(option.value)}
            />
          ))}
          <small className="muted">
            {body.length}/{STATUS_TEXT_MAX_LENGTH}
          </small>
        </div>
        <p className="hint">Dura 24 horas y lo ven solo las personas de tu agenda que también te agregaron.</p>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || body.trim().length === 0}>
          {busy ? 'Publicando…' : 'Publicar'}
        </button>
      </form>
    </Modal>
  );
}
