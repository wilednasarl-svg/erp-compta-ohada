import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ERP Compta — OHADA',
    short_name: 'ERP Compta',
    description: 'Comptabilité SYSCOHADA — Bilan, CR, TFT, DSF',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#f7f4ef',
    theme_color: '#1e5c3a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
    shortcuts: [
      {
        name: 'Tableau de bord',
        short_name: 'Dashboard',
        url: '/dashboard',
        icons: [{ src: '/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Rapports financiers',
        short_name: 'Rapports',
        url: '/reports/console',
        icons: [{ src: '/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
