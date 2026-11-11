'use client';

import { useEffect, useId, type ReactNode } from 'react';
import { CloseIcon } from './icons';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <CloseIcon />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
