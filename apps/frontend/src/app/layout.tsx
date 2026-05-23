import './globals.css';

import type { Metadata } from 'next';

import { AuthHydrationGate } from '@/components/auth-hydration-gate';
import { ReactQueryProvider } from '@/components/react-query-provider';

export const metadata: Metadata = {
  title: 'ERP Compta',
  description: 'Plateforme SaaS de retraitement comptable OHADA.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-background antialiased">
        <ReactQueryProvider>
          <AuthHydrationGate>{children}</AuthHydrationGate>
        </ReactQueryProvider>
      </body>
    </html>
  );
}
