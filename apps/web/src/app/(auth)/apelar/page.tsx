'use client';

import { APPEAL_MESSAGE_MAX_LENGTH, APPEAL_MESSAGE_MIN_LENGTH } from '@qemzagram/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { MailIcon } from '@/components/icons';
import { PasswordField } from '@/components/PasswordField';
import { api, errorMessage } from '@/lib/api';

/**
 * Apelar la baja de una cuenta. La cuenta no puede iniciar sesión, así que se piden las mismas
 * credenciales que en el login: solo la persona dueña de la cuenta puede apelar.
 */
export default function AppealPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/appeal', { body: { identifier, password, message } });
      setSent(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="center-stack">
        <div className="state-icon" aria-hidden="true">
          <MailIcon />
        </div>
        <h2>Recibimos tu apelación</h2>
        <p className="muted">Una persona de soporte la va a revisar y te vamos a avisar por correo con la decisión.</p>
        <Link href="/login" className="btn btn-primary">
          Volver al inicio
        </Link>
      </div>
    );
  }

  return (
    <>
      <h2>Apelar la baja de mi cuenta</h2>
      <p className="muted">Si creés que tu cuenta fue dada de baja por error, contanos por qué. Soporte revisa cada apelación.</p>
      <form onSubmit={submit} className="form" noValidate>
        <div className="field">
          <label htmlFor="identifier">Tag o correo</label>
          <input id="identifier" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" autoCapitalize="none" required maxLength={254} />
        </div>
        <PasswordField label="Contraseña" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="field">
          <label htmlFor="message">¿Por qué debería revisarse?</label>
          <textarea id="message" rows={5} value={message} onChange={(event) => setMessage(event.target.value)} minLength={APPEAL_MESSAGE_MIN_LENGTH} maxLength={APPEAL_MESSAGE_MAX_LENGTH} required />
          <small className="muted">
            {message.trim().length}/{APPEAL_MESSAGE_MAX_LENGTH} (mínimo {APPEAL_MESSAGE_MIN_LENGTH})
          </small>
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || !identifier || !password || message.trim().length < APPEAL_MESSAGE_MIN_LENGTH}>
          {busy ? 'Enviando…' : 'Enviar apelación'}
        </button>
      </form>
      <div className="auth-links">
        <Link href="/login">Volver a iniciar sesión</Link>
      </div>
    </>
  );
}
