'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Avatar } from './Avatar';
import { ChatIcon, CloseIcon, ContactsIcon, HelpIcon, LogoutIcon, MenuIcon, NearbyIcon, SettingsIcon, StatusIcon, UserIcon } from './icons';
import { LogoMark } from './Logo';

const TABS = [
  { href: '/chats', label: 'Chats', Icon: ChatIcon },
  { href: '/estados', label: 'Estados', Icon: StatusIcon },
  { href: '/cercanos', label: 'Cercanos', Icon: NearbyIcon },
  { href: '/contactos', label: 'Contactos', Icon: ContactsIcon },
] as const;

const SUPPORT_EMAIL = 'soporte@qemzagram.com';

/**
 * Menú móvil en dos partes:
 *  1) barra superior FIJA con las secciones principales (siempre visible);
 *  2) panel DESPLEGABLE desde la misma barra con perfil, ajustes, ayuda y salida.
 */
export function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onClick = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!user) return null;

  return (
    <header className="app-header">
      <div className="app-header-bar">
        <Link href="/chats" className="header-brand" aria-label="Qemzagram">
          <LogoMark size={34} />
          <span className="header-brand-name">
            Qemza<span>gram</span>
          </span>
        </Link>

        <nav className="header-tabs" aria-label="Secciones principales">
          {TABS.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className="header-tab" aria-current={pathname.startsWith(href) ? 'page' : undefined}>
              <Icon />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="header-menu" ref={panelRef}>
          <button className="icon-btn" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="menu" aria-label="Abrir menú">
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
          {open && (
            <div className="menu-panel" role="menu">
              <Link href="/perfil" className="menu-profile" role="menuitem">
                <Avatar user={user} size={48} />
                <span>
                  <strong>{user.displayName}</strong>
                  <small>@{user.tag}</small>
                </span>
              </Link>
              <Link href="/perfil" className="menu-item" role="menuitem">
                <UserIcon /> Mi perfil
              </Link>
              <Link href="/ajustes" className="menu-item" role="menuitem">
                <SettingsIcon /> Ajustes
              </Link>
              <a className="menu-item" role="menuitem" href={`mailto:${SUPPORT_EMAIL}?subject=Soporte%20Qemzagram`}>
                <HelpIcon /> Ayuda y soporte
              </a>
              <button
                className="menu-item menu-danger"
                role="menuitem"
                onClick={async () => {
                  await logout();
                  router.replace('/login');
                }}
              >
                <LogoutIcon /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
