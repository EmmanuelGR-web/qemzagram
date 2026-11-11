'use client';

import type { ContactDto, ConversationDto, PublicUser } from '@qemzagram/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ProfileHeader } from '@/components/ProfileHeader';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function PublicProfilePage() {
  const { tag } = useParams<{ tag: string }>();
  const router = useRouter();
  const { user: me } = useAuth();
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [inAgenda, setInAgenda] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api<PublicUser>(`/users/by-tag/${encodeURIComponent(tag)}`), api<ContactDto[]>('/contacts')])
      .then(([loaded, contacts]) => {
        if (!active) return;
        setProfile(loaded);
        setInAgenda(contacts.some((contact) => contact.user.id === loaded.id));
      })
      .catch((caught: unknown) => active && setError(errorMessage(caught)));
    return () => {
      active = false;
    };
  }, [tag]);

  async function addToAgenda() {
    if (!profile) return;
    setBusy(true);
    try {
      await api('/contacts', { body: { tag: profile.tag } });
      setInAgenda(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function chat() {
    if (!profile) return;
    setBusy(true);
    try {
      const conversation = await api<ConversationDto>('/chats/direct', { body: { tag: profile.tag } });
      router.push(`/chats/${conversation.id}`);
    } catch (caught) {
      setError(errorMessage(caught));
      setBusy(false);
    }
  }

  if (error && !profile) {
    return (
      <div className="page">
        <p className="alert alert-error">{error}</p>
        <Link href="/contactos" className="btn btn-ghost">
          Volver
        </Link>
      </div>
    );
  }
  if (!profile) return <div className="page muted">Cargando perfil…</div>;
  const isMe = me?.id === profile.id;

  return (
    <div className="page">
      <ProfileHeader
        user={profile}
        actions={
          isMe ? (
            <Link href="/perfil" className="btn btn-primary">
              Editar mi perfil
            </Link>
          ) : (
            <>
              {inAgenda ? (
                <button className="btn btn-primary" onClick={chat} disabled={busy}>
                  Enviar mensaje
                </button>
              ) : (
                <button className="btn btn-primary" onClick={addToAgenda} disabled={busy}>
                  Agregar a mi agenda
                </button>
              )}
            </>
          )
        }
      />
      {profile.isPrivate && !isMe && !profile.bio && <p className="muted small">Esta cuenta es privada: solo muestra más información a quienes agregó a su agenda.</p>}
      {error && <p className="alert alert-error">{error}</p>}
    </div>
  );
}
