'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Logo, LogoMark } from '@/components/Logo';
import { useAuth } from '@/lib/auth-context';

export default function AuthLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace('/chats');
  }, [loading, user, router]);

  return (
    <main className="auth-page">
      <aside className="auth-hero" aria-hidden="true">
        <div className="auth-hero-inner">
          {/* Logo y nombre forman un bloque: el logo queda centrado respecto del nombre. */}
          <div className="hero-brand">
            <LogoMark size={120} variant="white" />
            <h1>
              Qemza<span>gram</span>
            </h1>
          </div>
          <p className="hero-tagline">Conectá. Compartí. Disfrutá.</p>
          <ul className="hero-points">
            <li>Sin número de teléfono: tu tag es tu identidad.</li>
            <li>Tus chats, cifrados y solo tuyos.</li>
            <li>Grupos, estados y llamadas en una sola app.</li>
          </ul>
          <p className="hero-by">by Neoematech</p>
        </div>
      </aside>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-logo">
            <Logo size={44} />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
