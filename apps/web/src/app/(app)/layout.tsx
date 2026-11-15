'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { CallOverlay } from '@/components/call/CallOverlay';
import { E2eePrompt } from '@/components/E2eePrompt';
import { LogoMark } from '@/components/Logo';
import { useAuth } from '@/lib/auth-context';
import { CallProvider } from '@/lib/call-context';
import { E2eeProvider } from '@/lib/e2ee-context';
import { registerServiceWorker } from '@/lib/push';
import { RealtimeProvider } from '@/lib/realtime-context';

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  // Service worker: necesario para recibir avisos de llamadas con la app cerrada.
  useEffect(() => {
    if (user) void registerServiceWorker();
  }, [user]);

  if (loading || !user) {
    return (
      <div className="splash">
        <LogoMark size={72} />
      </div>
    );
  }

  return (
    <RealtimeProvider>
      <E2eeProvider>
        <CallProvider>
          <div className="app-shell">
            <AppHeader />
            <main className="app-main">{children}</main>
          </div>
          <CallOverlay />
          <E2eePrompt />
        </CallProvider>
      </E2eeProvider>
    </RealtimeProvider>
  );
}
