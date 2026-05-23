'use client';

import Link from 'next/link';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCurrentOrg, useCurrentUser } from '@/stores/auth-store';

/**
 * MVP dashboard. Lands the user post-`select-organization`; the real
 * KPIs / accounting widgets ship with Module 2. Until then, the
 * surface is a welcome banner plus quick-access tiles to the live
 * Module 1 management screens (members + invitations + MFA).
 */
export default function DashboardPage() {
  const user = useCurrentUser();
  const currentOrg = useCurrentOrg();

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Bienvenue, {user?.firstName ?? user?.email ?? ''}
          </h1>
          <p className="text-sm text-muted-foreground">
            Vous êtes connecté à{' '}
            <span className="font-medium text-foreground">{currentOrg?.name}</span> avec le rôle{' '}
            <span className="font-medium text-foreground">{currentOrg?.role}</span>.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Membres</CardTitle>
              <CardDescription>Gérez l'équipe de l'organisation.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/members">Voir les membres</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Invitations</CardTitle>
              <CardDescription>Invitez de nouveaux membres par email.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/invitations">Inviter</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sécurité MFA</CardTitle>
              <CardDescription>
                Renforcez votre compte avec une application d'authentification.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings/mfa">Configurer le MFA</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="sm:col-span-2 lg:col-span-3">
            <CardHeader>
              <CardTitle>Module 2 — comptabilité OHADA</CardTitle>
              <CardDescription>À venir.</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Plan comptable, journaux, écritures, états de synthèse. Implémentation en cours de
              cadrage.
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
