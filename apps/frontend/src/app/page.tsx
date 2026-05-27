import Link from 'next/link';

import { Button } from '@/components/ui/button';

/**
 * Root marketing page — minimal landing that funnels visitors to
 * either signup or login. Replace with a real marketing surface
 * post-MVP; for now this exists so `/` doesn't 404 and the auth
 * hydration gate has somewhere to bounce visitors that arrive at the
 * naked origin.
 */
export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-canvas px-4 py-16">
      <div className="space-y-4 text-center">
        <p className="eyebrow">ERP Compta OHADA</p>
        <h1 className="font-display text-4xl font-medium tracking-tight text-ink sm:text-5xl">
          ERP Compta
        </h1>
        <p className="max-w-prose text-balance text-ink-mute">
          Plateforme SaaS de retraitement comptable OHADA — multi-cabinet, multi-rôle, multi-organisation.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild size="lg">
          <Link href="/signup">Créer un compte</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/login">Se connecter</Link>
        </Button>
      </div>
    </main>
  );
}
