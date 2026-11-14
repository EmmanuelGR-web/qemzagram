'use client';

import type { ContactDto, ConversationDto, PublicUser } from '@qemzagram/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Modal } from '@/components/Modal';
import { ProfileHeader } from '@/components/ProfileHeader';
import { ReportDialog } from '@/components/ReportDialog';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { BLOCK_EXPLANATION, blockUser, listBlocked, unblockUser } from '@/lib/blocks';

export default function PublicProfilePage() {
  const { tag } = useParams<{ tag: string }>();
  const router = useRouter();
  const { user: me } = useAuth();
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [inAgenda, setInAgenda] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([api<PublicUser>(`/users/by-tag/${encodeURIComponent(tag)}`), api<ContactDto[]>('/contacts'), listBlocked()])
      .then(([loaded, contacts, blockedList]) => {
        if (!active) return;
        setProfile(loaded);
        setInAgenda(contacts.some((contact) => contact.user.id === loaded.id));
        setBlocked(blockedList.some((item) => item.user.id === loaded.id));
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

  async function toggleBlock(next: boolean) {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      if (next) await blockUser(profile.id);
      else await unblockUser(profile.id);
      setBlocked(next);
      setConfirmBlock(false);
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
              {blocked ? (
                <button className="btn btn-primary" onClick={() => void toggleBlock(false)} disabled={busy}>
                  Desbloquear
                </button>
              ) : inAgenda ? (
                <button className="btn btn-primary" onClick={chat} disabled={busy}>
                  Enviar mensaje
                </button>
              ) : (
                <button className="btn btn-primary" onClick={addToAgenda} disabled={busy}>
                  Agregar a mi agenda
                </button>
              )}
              {!blocked && (
                <button className="btn btn-ghost" onClick={() => setConfirmBlock(true)} disabled={busy}>
                  Bloquear
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setReporting(true)} disabled={busy}>
                Denunciar
              </button>
            </>
          )
        }
      />
      {profile.isPrivate && !isMe && !profile.bio && <p className="muted small">Esta cuenta es privada: solo muestra más información a quienes agregó a su agenda.</p>}
      {blocked && !isMe && <p className="muted small">Bloqueaste a esta persona.</p>}
      {error && <p className="alert alert-error">{error}</p>}
      {reporting && (
        <ReportDialog
          user={profile}
          alreadyBlocked={blocked}
          onClose={() => setReporting(false)}
          onDone={(result) => result.blocked && setBlocked(true)}
        />
      )}
      {confirmBlock && (
        <Modal title={`¿Bloquear a ${profile.displayName}?`} onClose={() => setConfirmBlock(false)}>
          <p>{BLOCK_EXPLANATION}</p>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmBlock(false)} disabled={busy}>
              Cancelar
            </button>
            <button className="btn btn-danger" onClick={() => void toggleBlock(true)} disabled={busy}>
              Bloquear
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
