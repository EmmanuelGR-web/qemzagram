'use client';

import { getPasswordIssues } from '@qemzagram/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { PasswordField } from '@/components/PasswordField';
import { LockIcon } from '@/components/icons';
import { api, errorMessage } from '@/lib/api';

function ResetContent() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = getPasswordIssues(password).length === 0 && password === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { body: { token, password } });
      setDone(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <p className="alert alert-error">El enlace no es válido.</p>;

  if (done) {
    return (
      <div className="center-stack">
        <div className="state-icon" aria-hidden="true">
          <LockIcon />
        </div>
        <h2>Contraseña actualizada</h2>
        <p className="muted">Por seguridad cerramos todas tus sesiones. Iniciá sesión con tu nueva contraseña.</p>
        <Link href="/login" className="btn btn-primary">
          Iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <>
      <h2>Nueva contraseña</h2>
      <p className="muted">Elegí una contraseña segura que no uses en otros sitios.</p>
      <form onSubmit={submit} className="form">
        <PasswordField label="Nueva contraseña" value={password} onChange={setPassword} autoComplete="new-password" showRules />
        <PasswordField label="Repetí la contraseña" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || !valid}>
          {busy ? 'Guardando…' : 'Guardar contraseña'}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="muted">Cargando…</p>}>
      <ResetContent />
    </Suspense>
  );
}
