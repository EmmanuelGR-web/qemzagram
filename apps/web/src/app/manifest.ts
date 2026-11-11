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
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
