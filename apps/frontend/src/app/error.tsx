'use client';

import Link from 'next/link';
import { useEffect } from 'react';

import { IllustrationOffline } from '@/components/ui/illustrations';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Trace minimale côté client ; le détail part déjà au monitoring serveur.
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error(error);
    }
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <IllustrationOffline className="h-20 w-32 text-ink-mute" />
      <div>
        <h1 className="font-display text-2xl font-medium text-ink sm:text-3xl">
          Une erreur s&apos;est produite
        </h1>
        <p className="mx-auto mt-2 max-w-[44ch] text-sm leading-relaxed text-ink-soft">
          Quelque chose n&apos;a pas fonctionné. Réessayez ; si le problème persiste, revenez au
          tableau de bord.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="press rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-[oklch(98%_0.004_85)] transition-opacity duration-fast hover:opacity-90"
        >
          Réessayer
        </button>
        <Link
          href="/dashboard"
          className="press rounded-sm border border-line-strong bg-canvas px-5 py-2.5 text-sm font-medium text-ink transition-colors duration-fast hover:bg-sunk"
        >
          Tableau de bord
        </Link>
      </div>
    </div>
  );
}
