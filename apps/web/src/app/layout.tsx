import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth-context';
import { PreferencesProvider } from '@/lib/preferences';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Qemzagram', template: '%s · Qemzagram' },
  description: 'Conectá. Compartí. Disfrutá. Mensajería y comunidad sin número de teléfono.',
  applicationName: 'Qemzagram',
  manifest: '/manifest.webmanifest',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#D91E36',
  width: 'device-width',
  initialScale: 1,
};

/**
 * Async + `connection()`: todas las páginas se renderizan en cada pedido. Es obligatorio para el CSP con
 * nonce: una página estática se genera al compilar, sin nonce, y el navegador bloquearía sus scripts.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <html lang="es" data-theme="system" data-font="md" data-chatbg="soft">
      <body>
        <PreferencesProvider>
          <AuthProvider>{children}</AuthProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
