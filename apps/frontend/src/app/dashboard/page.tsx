'use client';

import { Building2, LogOut, User as UserIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { api } from '@/lib/api-client';
import { useAuthStore, useCurrentOrg, useCurrentUser } from '@/stores/auth-store';

/**
 * MVP dashboard. Confirms the auth flow worked end-to-end (user +
 * current org + scoped token are in the store) and gives the user a
 * logout path. Real KPIs / accounting widgets land with Module 2.
 */
export default function DashboardPage() {
  const router = useRouter();
  const user = useCurrentUser();
  const currentOrg = useCurrentOrg();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const signout = useAuthStore((s) => s.signout);

  const logoutMutation = useApiMutation<undefined, void>(async () => {
    if (typeof refreshToken === 'string') {
      // Best-effort: ignore network errors so an offline user can still
      // clear their local session.
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    return undefined;
  });

  const handleLogout = async (): Promise<void> => {
    // `mutateAsync(undefined)` is required because TVariables is `void`;
    // TanStack Query still wants a positional argument even when the
    // mutation takes nothing.
    await logoutMutation.mutateAsync(undefined);
    signout();
    router.replace('/login');
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            {currentOrg?.name ?? 'Organisation'}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <UserIcon className="h-4 w-4" />
              {user?.email ?? '—'}
            </span>
            <Button size="sm" variant="outline" onClick={() => void handleLogout()}>
              <LogOut className="mr-2 h-3.5 w-3.5" /> Déconnexion
            </Button>
          </div>
        </div>
      </header>

      <main className="container space-y-6 py-10">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Bienvenue, {user?.firstName ?? user?.email ?? ''}</h1>
          <p className="text-sm text-muted-foreground">
            Vous êtes connecté à <span className="font-medium text-foreground">{currentOrg?.name}</span> avec le
            rôle <span className="font-medium text-foreground">{currentOrg?.role}</span>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Module 1 — actif</CardTitle>
              <CardDescription>
                Authentification, organisations, membres, RBAC, MFA, invitations, journal d'audit.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Le backend Module 1 est en place. Vous pouvez gérer votre organisation et inviter des collaborateurs.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Module 2 — comptabilité OHADA</CardTitle>
              <CardDescription>À venir.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Plan comptable, journaux, écritures, états de synthèse. Implémentation en cours de cadrage.
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
