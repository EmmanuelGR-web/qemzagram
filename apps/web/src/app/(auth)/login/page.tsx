'use client';

import type { SelfUser } from '@qemzagram/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PasswordField } from '@/components/PasswordField';
import { api, ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [banned, setBanned] = useState(false);
  const [resendEmail, setResendEmail] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { user } = await api<{ user: SelfUser }>('/auth/login', { body: { identifier, password } });
      setUser(user);
      router.replace('/chats');
    } catch (caught) {
      setNeedsVerification(caught instanceof ApiError && caught.code === 'EMAIL_NOT_VERIFIED');
      setBanned(caught instanceof ApiError && caught.code === 'ACCOUNT_BANNED');
      if (identifier.includes('@')) setResendEmail(identifier);
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      await api('/auth/resend-verification', { body: { email: resendEmail } });
      setNotice('Listo. Si el correo existe, te enviamos un nuevo enlace de verificación.');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <>
      <h2>Iniciar sesión</h2>
      <p className="muted">Entrá con tu tag o tu correo electrónico.</p>
      <form onSubmit={submit} className="form" noValidate>
        <div className="field">
          <label htmlFor="identifier">Tag o correo</label>
          <input id="identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" autoCapitalize="none" required maxLength={254} />
        </div>
        <PasswordField label="Contraseña" value={password} onChange={setPassword} autoComplete="current-password" />
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="alert alert-ok">{notice}</p>}
        {banned && (
          <p className="muted small">
            ¿Creés que es un error? <Link href="/apelar">Apelá la decisión</Link> y soporte la va a revisar.
          </p>
        )}
        {needsVerification && (
          <div className="field">
            <label htmlFor="resend">Reenviar verificación a</label>
            <div className="inline-form">
              <input id="resend" type="email" value={resendEmail} onChange={(event) => setResendEmail(event.target.value)} placeholder="tu@correo.com" />
              <button type="button" className="btn btn-ghost" onClick={resend}>
                Reenviar
              </button>
            </div>
          </div>
        )}
        <button className="btn btn-primary" disabled={busy || !identifier || !password}>
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
      <div className="auth-links">
        <Link href="/recuperar">Olvidé mi contraseña</Link>
        <Link href="/registro">Crear cuenta</Link>
      </div>
    </>
  );
}
