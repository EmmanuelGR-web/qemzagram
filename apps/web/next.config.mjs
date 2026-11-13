const API_URL = process.env.API_URL ?? 'http://localhost:4000';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';
const isDev = process.env.NODE_ENV !== 'production';
/** Servidor de llamadas (LiveKit). El navegador se conecta directo con un token de vida corta que da la API. */
const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL ?? 'ws://localhost:7880';

// Política de seguridad de contenido (CSP). 'unsafe-inline' en script/style lo exige Next.js sin nonces;
// en la Fase de endurecimiento se migra a CSP con nonce (ver docs/SEGURIDAD.md).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self' ${WS_URL} ${WS_URL.replace(/^http/, 'ws')} ${LIVEKIT_URL} ${LIVEKIT_URL.replace(/^ws/, 'http')}${isDev ? ' ws://localhost:3000' : ''}`,
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
          { key: 'Content-Security-Policy', value: csp },
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
