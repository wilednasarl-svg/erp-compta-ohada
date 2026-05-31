'use client';

import { IllustrationOffline } from '@/components/ui/illustrations';

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <IllustrationOffline className="h-20 w-32 text-ink-mute" />
      <div>
        <h1 className="font-display text-2xl font-medium text-ink sm:text-3xl">
          Connexion indisponible
        </h1>
        <p className="mx-auto mt-2 max-w-[40ch] text-sm leading-relaxed text-ink-soft">
          Vérifiez votre réseau et réessayez. Les données déjà consultées restent accessibles
          hors-ligne.
        </p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="press rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-[oklch(98%_0.004_85)] transition-opacity duration-fast hover:opacity-90"
      >
        Réessayer
      </button>
    </div>
  );
}
