import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { LEGAL_VERSION } from '@qemzagram/shared';

/**
 * Páginas legales (Términos y Privacidad): públicas, con o sin sesión.
 * Van en su propio grupo porque el layout de (auth) redirige a /chats a quien ya inició sesión.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="legal-shell">
      <header className="legal-top">
        <Link href="/" aria-label="Volver a Qemzagram">
          <Logo size={34} />
        </Link>
        <nav className="legal-nav" aria-label="Documentos legales">
          <Link href="/terminos">Términos</Link>
          <Link href="/privacidad">Privacidad</Link>
        </nav>
      </header>
      <main className="page legal-doc">
        <p className="draft-banner" role="note">
          <strong>Borrador pendiente de revisión legal.</strong> Este texto describe cómo funciona Qemzagram hoy, pero todavía no fue
          revisado por un/a abogado/a. Versión {LEGAL_VERSION}.
        </p>
        {children}
      </main>
    </div>
  );
}
