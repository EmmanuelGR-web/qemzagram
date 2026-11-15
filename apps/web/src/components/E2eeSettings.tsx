'use client';

import { keyFingerprint } from '@qemzagram/shared';
import { useEffect, useState } from 'react';
import { useE2ee } from '@/lib/e2ee-context';
import { E2eeDialog } from './E2eeDialog';

const STATUS_TEXT: Record<string, string> = {
  loading: 'Revisando…',
  unsupported: 'Este navegador no admite el cifrado de extremo a extremo (hace falta HTTPS y un navegador actualizado).',
  missing: 'Todavía no lo activaste. Tus mensajes nuevos se guardan cifrados en el servidor, pero no de extremo a extremo.',
  locked: 'Tu cuenta tiene claves, pero este dispositivo no. Ingresá tu código de recuperación para leer tus mensajes cifrados.',
  error: 'No pudimos revisar tus claves. Probá recargar la página.',
};

/** Ajustes → Seguridad: estado del cifrado, mi código de seguridad y claves nuevas si se perdió el código. */
export function E2eeSettings() {
  const { status, device } = useE2ee();
  const [dialog, setDialog] = useState<'create' | 'unlock' | 'reset' | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (device) void keyFingerprint(device.publicJwk).then((value) => active && setFingerprint(value));
    else setFingerprint(null);
    return () => {
      active = false;
    };
  }, [device]);

  return (
    <>
      <div className="setting">
        <div>
          <strong>Cifrado de extremo a extremo</strong>
          <small>{status === 'ready' ? 'Activado en este dispositivo. Solo vos y las personas del chat pueden leer tus mensajes.' : STATUS_TEXT[status]}</small>
          {fingerprint && (
            <small>
              Tu código de seguridad: <span className="safety-code">{fingerprint}</span>
            </small>
          )}
        </div>
        {status === 'missing' && (
          <button className="btn btn-primary btn-sm" onClick={() => setDialog('create')}>
            Activar
          </button>
        )}
        {status === 'locked' && (
          <button className="btn btn-primary btn-sm" onClick={() => setDialog('unlock')}>
            Ingresar código
          </button>
        )}
        {status === 'ready' && (
          <button className="btn btn-ghost btn-sm" onClick={() => setDialog('reset')}>
            Generar claves nuevas
          </button>
        )}
      </div>
      {dialog && <E2eeDialog mode={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
