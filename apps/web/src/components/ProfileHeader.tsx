import type { PublicUser } from '@qemzagram/shared';
import type { ReactNode } from 'react';
import { mediaUrl } from '@/lib/api';
import { Avatar } from './Avatar';

/** Portada + foto de perfil superpuesta (estilo red social). */
export function ProfileHeader({ user, actions, coverAction, avatarAction }: { user: PublicUser; actions?: ReactNode; coverAction?: ReactNode; avatarAction?: ReactNode }) {
  const cover = mediaUrl(user.coverUrl);
  return (
    <section className="profile-card">
      <div className="profile-cover" style={cover ? { backgroundImage: `url(${cover})` } : undefined}>
        {coverAction && <div className="cover-action">{coverAction}</div>}
      </div>
      <div className="profile-main">
        <div className="profile-avatar">
          <Avatar user={user} size={112} />
          {avatarAction && <div className="avatar-action">{avatarAction}</div>}
        </div>
        <div className="profile-info">
          <h2>{user.displayName}</h2>
          <p className="profile-tag">@{user.tag}</p>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
          {user.isPrivate && <span className="badge">Cuenta privada</span>}
        </div>
        {actions && <div className="profile-actions">{actions}</div>}
      </div>
    </section>
  );
}
