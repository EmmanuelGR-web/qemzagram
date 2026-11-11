'use client';

import { BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH, type SelfUser } from '@qemzagram/shared';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { CameraIcon } from '@/components/icons';
import { ProfileHeader } from '@/components/ProfileHeader';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const MAX_BYTES = 5 * 1024 * 1024;

export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const avatarCamera = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setBio(user.bio);
    }
  }, [user]);

  if (!user) return null;

  async function upload(kind: 'avatar' | 'cover', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError('La imagen supera los 5 MB.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      setUser(await api<SelfUser>(`/users/me/${kind}`, { form }));
      setNotice(kind === 'avatar' ? 'Foto de perfil actualizada.' : 'Portada actualizada.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(kind: 'avatar' | 'cover') {
    setBusy(true);
    try {
      setUser(await api<SelfUser>(`/users/me/${kind}`, { method: 'DELETE' }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setUser(await api<SelfUser>('/users/me', { method: 'PATCH', body: { displayName, bio } }));
      setNotice('Perfil guardado.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <ProfileHeader
        user={user}
        coverAction={
          <button className="btn btn-glass btn-sm" onClick={() => coverInput.current?.click()} disabled={busy}>
            <CameraIcon /> Cambiar portada
          </button>
        }
        avatarAction={
          <button className="avatar-edit" onClick={() => avatarInput.current?.click()} disabled={busy} aria-label="Cambiar foto de perfil">
            <CameraIcon />
          </button>
        }
      />
      <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => upload('avatar', event)} />
      <input ref={avatarCamera} type="file" accept="image/*" capture="user" hidden onChange={(event) => upload('avatar', event)} />
      <input ref={coverInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => upload('cover', event)} />

      <div className="card">
        <div className="button-row">
          <button className="btn btn-ghost btn-sm" onClick={() => avatarCamera.current?.click()} disabled={busy}>
            Sacar foto con la cámara
          </button>
          {user.avatarUrl && (
            <button className="btn btn-ghost btn-sm" onClick={() => removeImage('avatar')} disabled={busy}>
              Quitar foto de perfil
            </button>
          )}
          {user.coverUrl && (
            <button className="btn btn-ghost btn-sm" onClick={() => removeImage('cover')} disabled={busy}>
              Quitar portada
            </button>
          )}
        </div>
      </div>

      <form onSubmit={save} className="card form">
        <h3>Información del perfil</h3>
        <div className="field">
          <label htmlFor="tag">Tag</label>
          <input id="tag" value={`@${user.tag}`} disabled readOnly />
          <small className="hint">El tag no se puede cambiar: es tu identidad única en Qemzagram.</small>
        </div>
        <div className="field">
          <label htmlFor="displayName">Nombre</label>
          <input id="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={DISPLAY_NAME_MAX_LENGTH} required />
        </div>
        <div className="field">
          <label htmlFor="bio">Info / biografía</label>
          <textarea id="bio" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={BIO_MAX_LENGTH} rows={3} />
          <small className="hint">
            {bio.length}/{BIO_MAX_LENGTH}
          </small>
        </div>
        <div className="field">
          <label htmlFor="email">Correo (privado)</label>
          <input id="email" value={user.email} disabled readOnly />
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p className="alert alert-ok">{notice}</p>}
        <button className="btn btn-primary" disabled={busy || displayName.trim().length === 0}>
          Guardar cambios
        </button>
      </form>
    </div>
  );
}
