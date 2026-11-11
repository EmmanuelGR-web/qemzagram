import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Qemzagram',
    short_name: 'Qemzagram',
    description: 'Conectá. Compartí. Disfrutá.',
    start_url: '/chats',
    display: 'standalone',
    background_color: '#FFFFFF',
    theme_color: '#D91E36',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // "maskable": Android recorta el ícono con su propia forma; este tiene margen para que no se corte la Q.
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
