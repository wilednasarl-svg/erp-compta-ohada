import Link from 'next/link';

import { IllustrationNotFound } from '@/components/ui/illustrations';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-6 text-center">
      <IllustrationNotFound className="h-24 w-24 text-ink-mute" />
      <div>
        <h1 className="font-display text-2xl font-medium text-ink sm:text-3xl">Page introuvable</h1>
        <p className="mx-auto mt-2 max-w-[44ch] text-sm leading-relaxed text-ink-soft">
          Cette page n&apos;existe pas ou a été déplacée. Vérifiez l&apos;adresse, ou revenez à votre
          tableau de bord.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="press rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-[oklch(98%_0.004_85)] transition-opacity duration-fast hover:opacity-90"
      >
        Retour au tableau de bord
      </Link>
    </div>
  );
}
