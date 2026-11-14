'use client';

import type { LoginResultDto, MfaMethod } from '@qemzagram/shared';
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
  /** Segundo paso: métodos disponibles (null = todavía en el paso de la contraseña). */
  const [mfaMethods, setMfaMethods] = useState<MfaMethod[] | null>(null);
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<LoginResultDto>('/auth/login', { body: { identifier, password } });
      if (result.mfaRequired) {
        setMfaMethods(result.methods);
        setMfaMethod(result.methods.includes('totp') ? 'totp' : 'backup');
        setPassword('');
        return;
      }
      setUser(result.user);
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

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<LoginResultDto>('/auth/mfa/verify', { body: { method: mfaMethod, code } });
      if (!result.mfaRequired) {
        setUser(result.user);
        router.replace('/chats');
      }
    } catch (caught) {
      // El ticket de 5 minutos venció: se vuelve al paso de la contraseña.
      if (caught instanceof ApiError && caught.code === 'MFA_EXPIRED') setMfaMethods(null);
      setError(errorMessage(caught));
      setCode('');
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

  if (mfaMethods) {
    return (
      <>
        <h2>Verificación en dos pasos</h2>
        <p className="muted">{mfaMethod === 'totp' ? 'Escribí el código de 6 dígitos que muestra tu app autenticadora.' : 'Escribí uno de tus códigos de respaldo.'}</p>
        <form onSubmit={verifyCode} className="form" noValidate>
          <div className="field">
            <label htmlFor="mfa-code">{mfaMethod === 'totp' ? 'Código de la app' : 'Código de respaldo'}</label>
            <input
              id="mfa-code"
              value={code}
              onChange={(event) => setCode(mfaMethod === 'totp' ? event.target.value.replace(/\D/g, '') : event.target.value)}
              inputMode={mfaMethod === 'totp' ? 'numeric' : 'text'}
              autoComplete="one-time-code"
              autoCapitalize="characters"
              maxLength={mfaMethod === 'totp' ? 6 : 9}
              autoFocus
            />
          </div>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" disabled={busy || (mfaMethod === 'totp' ? code.length !== 6 : code.trim().length < 8)}>
            {busy ? 'Verificando…' : 'Verificar'}
          </button>
        </form>
        <div className="auth-links">
          {mfaMethods.includes('totp') && mfaMethods.includes('backup') && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setMfaMethod(mfaMethod === 'totp' ? 'backup' : 'totp');
                setCode('');
                setError(null);
              }}
            >
              {mfaMethod === 'totp' ? 'Usar un código de respaldo' : 'Usar la app autenticadora'}
            </button>
          )}
          <button type="button" className="link-btn" onClick={() => setMfaMethods(null)}>
            Volver
          </button>
        </div>
      </>
    );
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
