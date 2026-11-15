import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
// La política de seguridad de contenido (CSP) con nonce la arma `src/proxy.ts` en cada respuesta (Fase 7A).

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // En la imagen Docker (NEXT_OUTPUT=standalone) Next arma un servidor mínimo con solo los archivos necesarios.
  // La raíz del monorepo hace falta para que incluya packages/shared.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? { output: 'standalone', outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '..', '..') }
    : {}),
  // El navegador solo habla con este mismo origen: las cookies de sesión quedan "first-party".
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/:path*` }];
  },
  async headers() {
    return [
      {
        // El service worker siempre se revisa (si no, una versión vieja podría quedar activa días).
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
