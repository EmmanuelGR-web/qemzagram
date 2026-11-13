'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { CallOverlay } from '@/components/call/CallOverlay';
import { LogoMark } from '@/components/Logo';
import { useAuth } from '@/lib/auth-context';
import { CallProvider } from '@/lib/call-context';
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
      <CallProvider>
        <div className="app-shell">
          <AppHeader />
          <main className="app-main">{children}</main>
        </div>
        <CallOverlay />
      </CallProvider>
    </RealtimeProvider>
  );
}
