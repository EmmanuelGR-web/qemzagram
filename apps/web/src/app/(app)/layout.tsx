'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { LogoMark } from '@/components/Logo';
import { useAuth } from '@/lib/auth-context';
import { RealtimeProvider } from '@/lib/realtime-context';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="splash">
        <LogoMark size={72} />
      </div>
    );
  }

  return (
    <RealtimeProvider>
      <div className="app-shell">
        <AppHeader />
        <main className="app-main">{children}</main>
      </div>
    </RealtimeProvider>
  );
}
