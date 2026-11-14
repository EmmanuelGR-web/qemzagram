'use client';

import type { BackupCodesDto, MfaStatusDto, SelfUser, TotpSetupDto } from '@qemzagram/shared';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Modal } from './Modal';
import { PasswordField } from './PasswordField';

type Dialog = 'setup' | 'disable' | 'regenerate' | null;

/** Ajustes → Seguridad: verificación en dos pasos con app autenticadora y códigos de respaldo. */
export function SecuritySettings() {
  const { setUser } = useAuth();
  const [status, setStatus] = useState<MfaStatusDto | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setStatus(await api<MfaStatusDto>('/auth/mfa'));
    setUser(await api<SelfUser>('/users/me'));
  }, [setUser]);

  useEffect(() => {
    api<MfaStatusDto>('/auth/mfa')
      .then(setStatus)
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, []);

  const finished = (result?: BackupCodesDto) => {
    setDialog(null);
    if (result) setCodes(result.codes);
    void reload().catch((caught: unknown) => setError(errorMessage(caught)));
  };

  return (
    <section className="card">
      <h3>Seguridad</h3>
      <div className="setting">
        <div>
          <strong>Verificación en dos pasos</strong>
          <small>
            {status?.totp
              ? `Activada con app autenticadora. Te quedan ${status.backupCodesLeft} códigos de respaldo.`
              : 'Además de tu contraseña, te pedimos un código de una app como Google Authenticator o Authy.'}
          </small>
        </div>
        {status?.totp ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setDialog('disable')}>
            Desactivar
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => setDialog('setup')} disabled={!status}>
            Activar
          </button>
        )}
      </div>
      {status?.enabled && (
        <div className="setting">
          <div>
            <strong>Códigos de respaldo</strong>
            <small>Sirven si perdés el celular. Cada uno se usa una sola vez.</small>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setDialog('regenerate')}>
            Generar nuevos
          </button>
        </div>
      )}
      {error && <p className="alert alert-error">{error}</p>}
      {dialog === 'setup' && <TotpSetupDialog onClose={() => setDialog(null)} onDone={finished} />}
      {dialog === 'disable' && <ConfirmDialog mode="disable" onClose={() => setDialog(null)} onDone={finished} />}
      {dialog === 'regenerate' && <ConfirmDialog mode="regenerate" onClose={() => setDialog(null)} onDone={finished} />}
      {codes && <BackupCodesDialog codes={codes} onClose={() => setCodes(null)} />}
    </section>
  );
}

function TotpSetupDialog({ onClose, onDone }: { onClose: () => void; onDone: (codes: BackupCodesDto) => void }) {
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await api<TotpSetupDto>('/auth/mfa/totp/setup', { body: { password } });
      setSetup(created);
      // El QR se dibuja EN EL NAVEGADOR: el secreto no pasa por ningún servicio externo.
      setQr(await QRCode.toDataURL(created.otpauthUrl, { margin: 1, width: 220, errorCorrectionLevel: 'M' }));
      setPassword('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api<BackupCodesDto>('/auth/mfa/totp/enable', { body: { code } }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Activar la verificación en dos pasos" onClose={onClose}>
      {!setup ? (
        <form className="form" onSubmit={start}>
          <p className="muted small">Por seguridad, confirmá tu contraseña.</p>
          <PasswordField label="Contraseña actual" value={password} onChange={setPassword} autoComplete="current-password" />
          {error && <p className="alert alert-error">{error}</p>}
          <button className="btn btn-primary" disabled={busy || !password}>
            Continuar
          </button>
        </form>
      ) : (
        <form className="form" onSubmit={confirm}>
          <ol className="mfa-steps">
            <li>Abrí tu app autenticadora (Google Authenticator, Authy, Microsoft Authenticator…).</li>
            <li>Escaneá este código QR. Desde el celular también podés tocar «Abrir en la app».</li>
          </ol>
          {qr && <img src={qr} alt="Código QR para la app autenticadora" className="mfa-qr" width={220} height={220} />}
          <a className="btn btn-ghost btn-sm" href={setup.otpauthUrl}>
            Abrir en la app
          </a>
          <details className="mfa-secret">
            <summary>¿No podés escanear? Ingresá esta clave a mano</summary>
            <code>{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
          </details>
          <div className="field">
            <label htmlFor="totp-code">3. Escribí el código de 6 dígitos que muestra la app</label>
            <input
              id="totp-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
            />
          </div>
          {error && <p className="alert alert-error">{error}</p>}
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>
            Activar
          </button>
        </form>
      )}
    </Modal>
  );
}

function ConfirmDialog({ mode, onClose, onDone }: { mode: 'disable' | 'regenerate'; onClose: () => void; onDone: (codes?: BackupCodesDto) => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'disable') {
        await api('/auth/mfa/totp/disable', { body: { password, code } });
        onDone();
      } else {
        onDone(await api<BackupCodesDto>('/auth/mfa/backup-codes', { body: { password, code } }));
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === 'disable' ? 'Desactivar la verificación en dos pasos' : 'Generar nuevos códigos de respaldo'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted small">
          {mode === 'disable'
            ? 'Tu cuenta va a quedar protegida solo por la contraseña. Las cuentas de soporte no pueden usar el panel sin este paso.'
            : 'Los códigos anteriores dejan de servir.'}
        </p>
        <PasswordField label="Contraseña actual" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="field">
          <label htmlFor="mfa-confirm-code">Código de la app o de respaldo</label>
          <input id="mfa-confirm-code" autoComplete="one-time-code" maxLength={12} value={code} onChange={(event) => setCode(event.target.value)} />
        </div>
        {error && <p className="alert alert-error">{error}</p>}
        <button className={mode === 'disable' ? 'btn btn-danger' : 'btn btn-primary'} disabled={busy || !password || code.trim().length < 6}>
          {mode === 'disable' ? 'Desactivar' : 'Generar'}
        </button>
      </form>
    </Modal>
  );
}

function BackupCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Tus códigos de respaldo" onClose={onClose}>
      <p>
        Guardalos en un lugar seguro (por ejemplo, un gestor de contraseñas). <b>No los vamos a volver a mostrar.</b> Cada uno sirve una sola vez si no tenés el celular a mano.
      </p>
      <ul className="mfa-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button
          className="btn btn-ghost"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(codes.join('\n'))
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
        >
          {copied ? 'Copiados' : 'Copiar'}
        </button>
        <button className="btn btn-primary" onClick={onClose}>
          Ya los guardé
        </button>
      </div>
    </Modal>
  );
}
