'use client';

import { formatRecoveryCode, normalizeRecoveryCode } from '@qemzagram/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '@/lib/api';
import { useE2ee, type PreparedKeys } from '@/lib/e2ee-context';
import { Modal } from './Modal';
import { PasswordField } from './PasswordField';

/**
 * Activar el cifrado de extremo a extremo (cuenta sin claves), abrirlo en un dispositivo nuevo
 * (con el código de recuperación) o generar claves nuevas si se perdió el código.
 */
export function E2eeDialog({ mode, onClose }: { mode: 'create' | 'unlock' | 'reset'; onClose: () => void }) {
  const [step, setStep] = useState<'create' | 'unlock' | 'reset'>(mode);
  const title = step === 'unlock' ? 'Abrí tus mensajes cifrados' : step === 'reset' ? 'Generar claves nuevas' : 'Activá el cifrado de extremo a extremo';
  return (
    <Modal title={title} onClose={onClose}>
      {step === 'create' && <CreateStep onDone={onClose} onLater={onClose} />}
      {step === 'unlock' && <UnlockStep onDone={onClose} onLost={() => setStep('reset')} onLater={onClose} />}
      {step === 'reset' && <ResetStep onDone={onClose} onCancel={mode === 'unlock' ? () => setStep('unlock') : onClose} />}
    </Modal>
  );
}

function CreateStep({ onDone, onLater }: { onDone: () => void; onLater: () => void }) {
  const { prepareKeys } = useE2ee();
  const [prepared, setPrepared] = useState<PreparedKeys | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (prepared) return <SaveCodeStep prepared={prepared} onDone={onDone} />;
  return (
    <div className="form">
      <p>
        Con el cifrado de extremo a extremo, <b>solo vos y las personas del chat</b> pueden leer los mensajes, fotos y llamadas. Ni Qemzagram ni soporte pueden verlos.
      </p>
      <p className="muted small">
        Te vamos a dar un <b>código de recuperación</b>. Lo vas a necesitar para leer tus mensajes en otro dispositivo o si borrás los datos del navegador. Nadie más lo tiene: si lo perdés, no lo podemos recuperar.
      </p>
      {error && <p className="alert alert-error">{error}</p>}
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onLater}>
          Más tarde
        </button>
        <button className="btn btn-primary" onClick={() => void prepareKeys().then(setPrepared, (caught: unknown) => setError(errorMessage(caught)))}>
          Crear mi código
        </button>
      </div>
    </div>
  );
}

/** Muestra el código y publica las claves SOLO después de que la persona confirma que lo guardó. */
function SaveCodeStep({ prepared, password, onDone }: { prepared: PreparedKeys; password?: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function download() {
    const text = `Código de recuperación de Qemzagram\n\n${prepared.code}\n\nGuardalo en un lugar seguro. Sirve para leer tus mensajes cifrados en otro dispositivo.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'qemzagram-codigo-de-recuperacion.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      await prepared.publish(password);
      onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <p>Este es tu código de recuperación. Guardalo en un gestor de contraseñas o anotalo en papel.</p>
      <code className="recovery-code" aria-label="Código de recuperación">
        {prepared.code}
      </code>
      <div className="modal-actions">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(prepared.code)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
        >
          {copied ? 'Copiado' : 'Copiar'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={download}>
          Descargar
        </button>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
        <span>Guardé el código. Entiendo que sin él no se pueden recuperar mis mensajes cifrados.</span>
      </label>
      {error && <p className="alert alert-error">{error}</p>}
      <button className="btn btn-primary" disabled={!saved || busy} onClick={() => void publish()}>
        {busy ? 'Activando…' : 'Activar el cifrado'}
      </button>
    </div>
  );
}

function UnlockStep({ onDone, onLost, onLater }: { onDone: () => void; onLost: () => void; onLater: () => void }) {
  const { restore } = useE2ee();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = normalizeRecoveryCode(code) !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await restore(code);
      onDone();
    } catch {
      setError('El código no es correcto. Revisalo y probá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <p>Este dispositivo todavía no tiene tus claves. Escribí tu código de recuperación para leer y enviar mensajes cifrados.</p>
      <div className="field">
        <label htmlFor="recovery-code">Código de recuperación</label>
        <input
          id="recovery-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={60}
          onBlur={() => {
            const normalized = normalizeRecoveryCode(code);
            if (normalized) setCode(formatRecoveryCode(normalized));
          }}
        />
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      <button className="btn btn-primary" disabled={!valid || busy}>
        {busy ? 'Abriendo…' : 'Abrir mis mensajes'}
      </button>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLater}>
          Más tarde
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLost}>
          Perdí mi código
        </button>
      </div>
    </form>
  );
}

function ResetStep({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { prepareKeys } = useE2ee();
  const [password, setPassword] = useState('');
  const [prepared, setPrepared] = useState<PreparedKeys | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (prepared) return <SaveCodeStep prepared={prepared} password={password} onDone={onDone} />;
  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        void prepareKeys().then(setPrepared, (caught: unknown) => setError(errorMessage(caught)));
      }}
    >
      <p className="alert alert-error">
        Vas a crear claves nuevas. <b>Los mensajes cifrados anteriores no se van a poder leer</b> en ningún dispositivo, y tus contactos van a ver que cambió tu código de seguridad.
      </p>
      <PasswordField label="Contraseña actual" value={password} onChange={setPassword} autoComplete="current-password" />
      {error && <p className="alert alert-error">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn btn-danger-ghost" disabled={!password}>
          Generar claves nuevas
        </button>
      </div>
    </form>
  );
}
