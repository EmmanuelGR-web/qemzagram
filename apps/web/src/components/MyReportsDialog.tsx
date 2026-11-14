'use client';

import { REPORT_REASON_LABELS, type MyReportDto } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { listMyReports } from '@/lib/reports';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

/** Ajustes → Mis denuncias: si ya fueron revisadas (no se informa la decisión exacta). */
export function MyReportsDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<MyReportDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyReports()
      .then(setItems)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, []);

  return (
    <Modal title="Mis denuncias" onClose={onClose}>
      <p className="muted small">Por privacidad, no informamos qué medida se tomó: solo si soporte ya revisó la denuncia.</p>
      {items === null && !error && <p className="muted">Cargando…</p>}
      {items?.length === 0 && <p className="muted">No hiciste ninguna denuncia.</p>}
      <ul className="contact-list">
        {items?.map((item) => (
          <li key={item.id} className="contact-row">
            <span className="contact-link">
              <Avatar user={{ tag: item.user.id, displayName: item.user.displayName, avatarUrl: item.user.avatarUrl }} size={40} />
              <span>
                <strong>{item.user.displayName}</strong>
                <small>
                  {REPORT_REASON_LABELS[item.reason]} · {new Date(item.createdAt).toLocaleDateString('es-AR')}
                  {item.evidenceCount > 0 ? ` · ${item.evidenceCount} adjuntos` : ''}
                </small>
              </span>
            </span>
            <span className="badge" data-tone={item.reviewed ? 'ok' : 'pending'}>
              {item.reviewed ? 'Revisada' : 'En revisión'}
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="alert alert-error">{error}</p>}
    </Modal>
  );
}
