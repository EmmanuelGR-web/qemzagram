import { NextResponse, type NextRequest } from 'next/server';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';
/** Servidor de llamadas (LiveKit): el navegador se conecta directo con un token de vida corta. */
const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? 'ws://localhost:7880';
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Política de seguridad de contenido (CSP) con NONCE (Fase 7A).
 * - Scripts: solo los que llevan el nonce de ESTA respuesta (Next se lo pone a los suyos) y los que
 *   ellos carguen ('strict-dynamic'). Un script inyectado por un atacante no tiene el nonce: no corre.
 * - Estilos: siguen con 'unsafe-inline' porque la interfaz usa atributos `style` (ver docs/SEGURIDAD.md).
 *   Inyectar CSS es mucho menos grave que inyectar JavaScript.
 * - 'unsafe-eval' solo en desarrollo (React lo usa para mostrar errores); nunca en producción.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Con 'strict-dynamic', 'self' se ignora en script-src: el service worker necesita su propia regla.
    "worker-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self' ${WS_URL} ${WS_URL.replace(/^http/, 'ws')} ${LIVEKIT_URL} ${LIVEKIT_URL.replace(/^ws/, 'http')}${isDev ? ' ws://localhost:3000' : ''}`,
    "font-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function proxy(request: NextRequest) {
  // 128 bits al azar por respuesta: imposible de adivinar.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildCsp(nonce);

  // Next lee el CSP de la PETICIÓN para saber qué nonce ponerle a sus scripts al renderizar.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Todo menos la API (proxy a Nest), los archivos estáticos y el service worker.
      source: '/((?!api|_next/static|_next/image|favicon.ico|sw.js|icons|stickers|brand|manifest.webmanifest|icon.svg|apple-icon.png).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
