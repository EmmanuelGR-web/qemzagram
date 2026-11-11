'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/forgot-password', { body: { email } });
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
        <div className="big-emoji" aria-hidden="true">
          📬
        </div>
        <h2>Revisá tu correo</h2>
        <p className="muted">Si ese correo tiene una cuenta, te enviamos un enlace para elegir una contraseña nueva. Vence en 1 hora.</p>
        <p className="muted small">¿No te llega nada? Escribí a soporte técnico desde la sección Ayuda de la app o respondé al correo de bienvenida.</p>
        <Link href="/login" className="btn btn-primary">
          Volver a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <>
      <h2>Recuperar contraseña</h2>
      <p className="muted">Ingresá el correo de tu cuenta y te enviamos los pasos.</p>
      <form onSubmit={submit} className="form">
        <div className="field">
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={254} />
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || email.length < 5}>
          {busy ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </form>
      <div className="auth-links">
        <Link href="/login">Volver</Link>
      </div>
    </>
  );
}
