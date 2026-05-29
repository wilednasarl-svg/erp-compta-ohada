import './globals.css';

import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';

import { AuthHydrationGate } from '@/components/auth-hydration-gate';
import { ReactQueryProvider } from '@/components/react-query-provider';
import { fraunces, geistMono, geistSans } from '@/lib/fonts';

export const viewport: Viewport = {
  themeColor: '#1e5c3a',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
};

export const metadata: Metadata = {
  title: 'ERP Compta — OHADA',
  description: 'Plateforme de retraitement comptable OHADA pour cabinets et PME.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ERP Compta',
  },
  icons: {
    apple: '/apple-touch-icon.png',
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable}`}
    >
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <ReactQueryProvider>
          <AuthHydrationGate>{children}</AuthHydrationGate>
        </ReactQueryProvider>
        <Toaster position="bottom-right" richColors closeButton />

      </body>
    </html>
  );
}
