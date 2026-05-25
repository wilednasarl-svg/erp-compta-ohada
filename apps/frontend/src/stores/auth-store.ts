import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import {
  setAuthToken,
  setRefreshToken,
  setOnTokensRotated,
  setOnAuthExpired,
} from '@/lib/api-client';
import type { OrganizationSummary, PublicUser } from '@/types/auth';

/**
 * Persistent auth state. Survives reloads via `localStorage` (keyed at
 * `erp-compta-auth/v1` so a schema bump can rotate the key and force a
 * fresh signin without bricking the client).
 *
 * Concerns kept out of this store:
 *   - Network calls — happen in the page-level mutation hooks; this
 *     store only RECEIVES the result via `signin` / `setOrg`.
 *   - Token refresh — owned by the API client (it sees the 401 first).
 *   - Org switching UX — the page calls `signin` again with the new
 *     scoped tokens after `POST /auth/select-organization`.
 *
 * The store keeps the accessToken in localStorage. This is a deliberate
 * MVP choice (vs httpOnly cookies): keeps the API client + frontend
 * fully decoupled from the backend's cookie surface, lets the same code
 * run against a Vercel deploy + a Railway backend without CORS-credential
 * gymnastics. The trade-off — XSS exposure of the token — is mitigated
 * by short access TTL (15 min) + refresh rotation + reuse detection
 * already implemented on the backend.
 */

interface AuthSnapshot {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: PublicUser;
  readonly organizations: ReadonlyArray<OrganizationSummary>;
  readonly currentOrg: OrganizationSummary | null;
}

interface AuthActions {
  /** Bind the result of a successful (non-MFA) login. */
  signin: (input: {
    accessToken: string;
    refreshToken: string;
    user: PublicUser;
    organizations: ReadonlyArray<OrganizationSummary>;
  }) => void;

  /**
   * Replace the token pair + current org after a successful
   * `POST /auth/select-organization`. Keeps `organizations` in sync.
   */
  setOrg: (input: {
    accessToken: string;
    refreshToken: string;
    organization: { id: string; name: string; role: string };
  }) => void;

  /**
   * Replace the token pair after a successful `POST /auth/refresh`
   * rotation. User + organizations are unchanged.
   */
  rotateTokens: (input: { accessToken: string; refreshToken: string }) => void;

  /** Clear everything and remove the bearer from the API client. */
  signout: () => void;
}

interface AuthState extends Partial<AuthSnapshot> {
  isHydrated: boolean;
}

export type AuthStore = AuthState & AuthActions;

const EMPTY: AuthState = { isHydrated: false };

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      ...EMPTY,

      signin: ({ accessToken, refreshToken, user, organizations }) => {
        setAuthToken(accessToken);
        setRefreshToken(refreshToken);
        set({
          isHydrated: true,
          accessToken,
          refreshToken,
          user,
          organizations,
          currentOrg: null,
        });
      },

      setOrg: ({ accessToken, refreshToken, organization }) => {
        setAuthToken(accessToken);
        setRefreshToken(refreshToken);
        set((state) => ({
          ...state,
          accessToken,
          refreshToken,
          currentOrg: organization,
        }));
      },

      rotateTokens: ({ accessToken, refreshToken }) => {
        setAuthToken(accessToken);
        setRefreshToken(refreshToken);
        set((state) => ({ ...state, accessToken, refreshToken }));
      },

      signout: () => {
        // Zustand `set` est un merge partiel — il faut explicitement
        // remettre chaque champ persisté à undefined / null, sinon
        // accessToken survit en localStorage et AuthHydrationGate
        // renvoie sur /dashboard au lieu de /login.
        setAuthToken(null);
        setRefreshToken(null);
        set({
          isHydrated: true,
          accessToken: undefined,
          refreshToken: undefined,
          user: undefined,
          organizations: undefined,
          currentOrg: null,
        });
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem('erp-compta-auth/v1');
          } catch {
            // localStorage indisponible (mode privé bloqué) — on a déjà
            // vidé le store en mémoire, le redirect /login fonctionnera
            // pour la session courante.
          }
        }
      },
    }),
    {
      name: 'erp-compta-auth/v1',
      storage: createJSONStorage(() => localStorage),
      // Only persist the snapshot fields — actions and hydration flag
      // are rebuilt on each load.
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        organizations: state.organizations,
        currentOrg: state.currentOrg,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken !== undefined) {
          setAuthToken(state.accessToken);
        }
        if (state?.refreshToken !== undefined) {
          setRefreshToken(state.refreshToken);
        }
        if (state !== undefined) {
          state.isHydrated = true;
        }
      },
    },
  ),
);

// Bridge the API client's refresh interceptor back into the store so a
// successful /auth/refresh rotation persists, and a failed one (expired
// or reuse-detected refresh token) clears the session and bounces the
// user to /login. Registered at module load — the store and the client
// share a process, so this runs once per app boot.
setOnTokensRotated(({ accessToken, refreshToken }) => {
  useAuthStore.getState().rotateTokens({ accessToken, refreshToken });
});
setOnAuthExpired(() => {
  useAuthStore.getState().signout();
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
});

/**
 * Selector hooks. Components subscribe to the slice they need so a
 * `currentOrg` change doesn't re-render every consumer of the token.
 */
export const useAccessToken = (): string | undefined =>
  useAuthStore((s) => s.accessToken);
export const useCurrentUser = (): PublicUser | undefined => useAuthStore((s) => s.user);
export const useCurrentOrg = (): OrganizationSummary | null | undefined =>
  useAuthStore((s) => s.currentOrg);
export const useOrganizations = (): ReadonlyArray<OrganizationSummary> | undefined =>
  useAuthStore((s) => s.organizations);
export const useIsHydrated = (): boolean => useAuthStore((s) => s.isHydrated);
