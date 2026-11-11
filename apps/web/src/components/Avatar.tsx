import type { PublicUser } from '@qemzagram/shared';
import { mediaUrl } from '@/lib/api';

const HUES = [350, 8, 22, 340, 0, 15];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function Avatar({ user, size = 44 }: { user: Pick<PublicUser, 'tag' | 'displayName' | 'avatarUrl'>; size?: number }) {
  const src = mediaUrl(user.avatarUrl);
  const hue = HUES[[...user.tag].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length] ?? 350;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue} 80% 58%), hsl(${hue} 78% 36%))` }}>
      {src ? <img src={src} alt="" width={size} height={size} /> : initials(user.displayName)}
    </span>
  );
}
