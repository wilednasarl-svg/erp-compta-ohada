'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuthStore } from '@/stores/auth-store';

/**
 * Route gate evaluated on the client after the Zustand store hydrates
 * from `localStorage`. Lives here (not in `middleware.ts`) because the
 * token lives in `localStorage` — invisible to Next.js middleware,
 * which only sees cookies.
 *
 * Rules:
 *   - Unauthenticated routes (`/login`, `/signup`, `/accept-invitation`)
 *     → no redirect, no token needed.
 *   - Authenticated routes (anything else):
 *       no token              → redirect to `/login`
 *       token + no currentOrg → redirect to `/organizations`
 *       token + currentOrg    → render the child page
 *
 * Wrapped around `{children}` in the root layout so every page passes
 * through. The first render shows nothing (avoids flashing the
 * dashboard for an unauthenticated user); the second render (after
 * hydration) either redirects or shows the child.
 */
const PUBLIC_ROUTES = ['/login', '/signup', '/accept-invitation', '/'];
const PRE_ORG_ROUTES = ['/organizations'];

export function AuthHydrationGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const accessToken = useAuthStore((s) => s.accessToken);
  const currentOrg = useAuthStore((s) => s.currentOrg);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }
    const isPublic = PUBLIC_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}?`));
    const isPreOrg = PRE_ORG_ROUTES.some((p) => pathname.startsWith(p));

    if (isPublic) {
      // Authenticated user landing on /login or /signup: bounce to wherever
      // their session can resume.
      if (accessToken !== undefined) {
        router.replace(currentOrg !== null && currentOrg !== undefined ? '/dashboard' : '/organizations');
      }
      return;
    }

    if (accessToken === undefined) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }

    if (!isPreOrg && (currentOrg === null || currentOrg === undefined)) {
      router.replace('/organizations');
    }
  }, [isHydrated, accessToken, currentOrg, pathname, router]);

  // First render (pre-hydration) is intentionally blank so an authed user
  // doesn't see /dashboard flash before the redirect, and an unauth user
  // doesn't see /dashboard at all.
  if (!isHydrated) {
    return <div className="min-h-screen" aria-hidden="true" />;
  }

  return <>{children}</>;
}
