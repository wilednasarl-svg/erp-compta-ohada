import './globals.css';

import type { Metadata } from 'next';

import { AuthHydrationGate } from '@/components/auth-hydration-gate';
import { ReactQueryProvider } from '@/components/react-query-provider';
import { fraunces, geistMono, geistSans } from '@/lib/fonts';

export const metadata: Metadata = {
  title: 'ERP Compta — OHADA',
  description: 'Plateforme de retraitement comptable OHADA pour cabinets et PME.',
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
      </body>
    </html>
  );
}
