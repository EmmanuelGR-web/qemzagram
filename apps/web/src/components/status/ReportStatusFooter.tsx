'use client';

import type { PublicUser, StatusDto } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { FlagIcon } from '@/components/icons';
import { ReportDialog } from '@/components/ReportDialog';

interface Props {
  user: PublicUser;
  status: StatusDto;
  pause: (paused: boolean) => void;
  /** Se denunció y además se bloqueó: la página debería cerrar el visor. */
  onBlocked: () => void;
}

/** Pie del visor en estados AJENOS: "Denunciar" con el estado actual ya adjuntado como evidencia. */
export function ReportStatusFooter({ user, status, pause, onBlocked }: Props) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    pause(open);
    return () => pause(false);
  }, [open, pause]);

  return (
    <>
      <span />
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <FlagIcon /> Denunciar
      </button>
      {open && (
        <ReportDialog
          user={user}
          preselected={[{ type: 'status', id: status.id }]}
          onClose={() => {
            setOpen(false);
            if (blocked) onBlocked();
          }}
          onDone={(result) => setBlocked(result.blocked)}
        />
      )}
    </>
  );
}
