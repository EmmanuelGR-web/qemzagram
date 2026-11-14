import type { PublicUser, SelfUser } from '@qemzagram/shared';
import type { UserRow } from '../database/schema';

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    tag: user.tag,
    displayName: user.displayName,
    bio: user.bio,
    avatarUrl: user.avatarUrl,
    coverUrl: user.coverUrl,
    isPrivate: user.isPrivate,
  };
}

/** Perfil reducido que ven los desconocidos cuando la cuenta es privada. */
export function toLimitedUser(user: UserRow): PublicUser {
  return { ...toPublicUser(user), bio: '', coverUrl: null };
}

export function toSelfUser(user: UserRow): SelfUser {
  return {
    ...toPublicUser(user),
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
    role: user.role,
    mfaEnabled: user.mfaEnabled,
  };
}
