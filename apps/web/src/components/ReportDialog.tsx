'use client';

import {
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_EVIDENCE_MAX,
  REPORT_REASON_LABELS,
  REPORT_REASONS,
  type ReportEvidenceSource,
  type ReportReason,
} from '@qemzagram/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { blockUser } from '@/lib/blocks';
import { REPORT_EXPLANATION, reportUser, type EvidenceCandidate } from '@/lib/reports';
import { Modal } from './Modal';

interface Props {
  user: { id: string; displayName: string };
  /** Mensajes o estados de esa persona que se pueden adjuntar (el más reciente primero). */
  candidates?: EvidenceCandidate[];
  /** Evidencia ya marcada (por ejemplo, el estado que se está viendo). */
  preselected?: { type: ReportEvidenceSource; id: string }[];
  /** Ocultar "también bloquear" si ya está bloqueada. */
  alreadyBlocked?: boolean;
  onClose: () => void;
  onDone?: (result: { blocked: boolean }) => void;
}

const key = (item: { type: string; id: string }) => `${item.type}:${item.id}`;

/** Denunciar a una persona: motivo, detalle opcional, evidencia elegida y opción de bloquear. */
export function ReportDialog({ user, candidates = [], preselected = [], alreadyBlocked = false, onClose, onDone }: Props) {
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(preselected.map(key)));
  const [alsoBlock, setAlsoBlock] = useState(!alreadyBlocked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function toggle(item: EvidenceCandidate) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key(item))) next.delete(key(item));
      else if (next.size < REPORT_EVIDENCE_MAX) next.add(key(item));
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      const evidence = [...selected].map((value) => {
        const [type, id] = value.split(':') as [ReportEvidenceSource, string];
        return { type, id };
      });
      await reportUser({ userId: user.id, reason, description, evidence });
      if (alsoBlock && !alreadyBlocked) await blockUser(user.id);
      setSent(true);
      onDone?.({ blocked: alsoBlock && !alreadyBlocked });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Modal title="Denuncia enviada" onClose={onClose}>
        <p>Gracias por avisarnos. Soporte la va a revisar{alsoBlock && !alreadyBlocked ? ` y ya bloqueaste a ${user.displayName}` : ''}.</p>
        <p className="muted small">Podés ver si ya fue revisada en Ajustes → Mis denuncias.</p>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Denunciar a ${user.displayName}`} onClose={onClose}>
      <form onSubmit={submit} className="form report-form">
        <p className="muted small">{REPORT_EXPLANATION}</p>
        <fieldset className="report-reasons">
          <legend>¿Qué pasó?</legend>
          {REPORT_REASONS.map((value) => (
            <label key={value} className="radio">
              <input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} />
              <span>{REPORT_REASON_LABELS[value]}</span>
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label htmlFor="report-description">Contanos más (opcional)</label>
          <textarea
            id="report-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
            placeholder="Qué pasó, desde cuándo…"
          />
        </div>

        {candidates.length > 0 && (
          <fieldset className="report-evidence">
            <legend>
              Adjuntá mensajes como prueba ({selected.size}/{REPORT_EVIDENCE_MAX})
            </legend>
            <ul>
              {candidates.map((item) => (
                <li key={key(item)}>
                  <label className="checkbox">
                    <input type="checkbox" checked={selected.has(key(item))} onChange={() => toggle(item)} disabled={!selected.has(key(item)) && selected.size >= REPORT_EVIDENCE_MAX} />
                    <span>
                      {item.label}
                      <small> · {new Date(item.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

        {!alreadyBlocked && (
          <label className="checkbox">
            <input type="checkbox" checked={alsoBlock} onChange={(event) => setAlsoBlock(event.target.checked)} />
            <span>También bloquear a {user.displayName}</span>
          </label>
        )}

        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button className="btn btn-danger" disabled={busy || !reason}>
            {busy ? 'Enviando…' : 'Enviar denuncia'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
