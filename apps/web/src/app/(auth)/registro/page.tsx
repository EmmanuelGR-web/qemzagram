'use client';

import { getPasswordIssues, registerSchema } from '@qemzagram/shared';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { PasswordField } from '@/components/PasswordField';
import { api, errorMessage } from '@/lib/api';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [tag, setTag] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const normalizedTag = tag.trim().toLowerCase().replace(/^@/, '');
  const passwordOk = getPasswordIssues(password, { tag: normalizedTag, email }).length === 0;
  const canSubmit = !busy && email.length > 3 && normalizedTag.length >= 3 && passwordOk && password === confirm;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = registerSchema.safeParse({ email, tag: normalizedTag, displayName: displayName.trim() || undefined, password });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join('. '));
      return;
    }
    setBusy(true);
    try {
      await api('/auth/register', { body: parsed.data });
      setDone(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="center-stack">
        <div className="big-emoji" aria-hidden="true">
          ✉️
        </div>
        <h2>Revisá tu correo</h2>
        <p className="muted">
          Te enviamos un enlace a <strong>{email}</strong> para verificar tu cuenta. Vence en 24 horas. Si no lo ves, mirá la carpeta de spam.
        </p>
        <Link href="/login" className="btn btn-primary">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

  return (
    <>
      <h2>Crear cuenta</h2>
      <p className="muted">Sin número de teléfono. Solo tu correo, un tag y una contraseña segura.</p>
      <form onSubmit={submit} className="form" noValidate>
        <div className="field">
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={254} />
        </div>
        <div className="field">
          <label htmlFor="tag">Tag (tu identificador único)</label>
          <div className="input-wrap prefixed">
            <span className="prefix">@</span>
            <input id="tag" value={tag.replace(/^@/, '')} onChange={(event) => setTag(event.target.value)} autoComplete="username" autoCapitalize="none" maxLength={20} required />
          </div>
          <small className="hint">3 a 20 caracteres: letras, números, punto o guion bajo. Otras personas te encuentran con este tag.</small>
        </div>
        <div className="field">
          <label htmlFor="name">Nombre para mostrar (opcional)</label>
          <input id="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} autoComplete="name" />
        </div>
        <PasswordField label="Contraseña" value={password} onChange={setPassword} autoComplete="new-password" showRules context={{ tag: normalizedTag, email }} />
        <PasswordField label="Repetí la contraseña" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {confirm.length > 0 && password !== confirm && <p className="alert alert-error">Las contraseñas no coinciden.</p>}
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={!canSubmit}>
          {busy ? 'Creando…' : 'Crear mi cuenta'}
        </button>
        <p className="legal">
          Al registrarte aceptás los Términos y la Política de Privacidad de Qemzagram. Tus datos se tratan conforme a la Ley 25.326.
        </p>
      </form>
      <div className="auth-links">
        <span>¿Ya tenés cuenta?</span>
        <Link href="/login">Iniciar sesión</Link>
      </div>
    </>
  );
}
