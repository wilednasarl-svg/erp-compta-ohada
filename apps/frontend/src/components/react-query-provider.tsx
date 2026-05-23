'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * Provider boundary for TanStack Query. The `QueryClient` is created
 * inside `useState` so each browser tab gets its own instance — sharing
 * it via a module-level singleton would survive a hot-reload and leak
 * cache across logical sessions.
 *
 * Defaults are tuned for an internal SaaS:
 *  - `staleTime: 30s` — most lists (members, invitations, events) can
 *    happily serve stale data for 30s; refetch-on-focus catches the
 *    "I came back to the tab" case.
 *  - `retry: 1` — one bounce on a transient network error, then surface.
 *    More retries hide deploy-time outages from the operator.
 *  - `refetchOnWindowFocus: true` — Next.js default behaviour suits
 *    this product.
 */
export function ReactQueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
