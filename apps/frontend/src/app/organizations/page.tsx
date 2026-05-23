'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { OrganizationSummary, SelectOrganizationResponse } from '@/types/auth';

/**
 * `GET /organizations` returns the orgs where the current user has an
 * active membership. The shape mirrors `OrganizationsService.listForUser`
 * — we also include the role so the UI can render a badge.
 */
async function fetchMyOrganizations(): Promise<ReadonlyArray<OrganizationSummary>> {
  const result = await api.get<{ organizations: ReadonlyArray<OrganizationSummary> }>(
    '/organizations',
  );
  return result.organizations;
}

export default function OrganizationsPage() {
  const router = useRouter();
  const setOrg = useAuthStore((s) => s.setOrg);
  const seededOrgs = useAuthStore((s) => s.organizations);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  // Use the orgs the login response shipped (cheap) but refetch from the
  // server so a membership added in another tab shows up. The query
  // `initialData` keeps the first paint instant.
  const orgsQuery = useQuery({
    queryKey: ['my-organizations'],
    queryFn: fetchMyOrganizations,
    initialData: seededOrgs,
  });

  const select = useApiMutation((organizationId: string) =>
    api.post<SelectOrganizationResponse>('/auth/select-organization', { organizationId }),
  );

  const orgs = orgsQuery.data ?? [];

  const handleSelect = async (orgId: string): Promise<void> => {
    setSelectedOrgId(orgId);
    try {
      const result = await select.mutateAsync(orgId);
      setOrg({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        organization: result.organization,
      });
      router.replace('/dashboard');
    } catch {
      // The error is rendered inline via select.error.
      setSelectedOrgId(null);
    }
  };

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-8 py-12">
      <div className="w-full max-w-2xl space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Choisissez votre organisation</h1>
        <p className="text-muted-foreground">
          Sélectionnez l'organisation sur laquelle vous souhaitez travailler. Vous pourrez en
          changer à tout moment depuis le menu utilisateur.
        </p>
      </div>

      <FormError error={select.error} className="w-full max-w-2xl" />

      {orgsQuery.isLoading && orgs.length === 0 ? (
        <Card className="w-full max-w-2xl">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Chargement…
          </CardContent>
        </Card>
      ) : orgs.length === 0 ? (
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Aucune organisation</CardTitle>
            <CardDescription>
              Créez votre première organisation pour commencer à utiliser ERP Compta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg">
              <Link href="/organizations/new">
                <Plus className="mr-2 h-4 w-4" /> Créer une organisation
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid w-full max-w-2xl gap-3">
          {orgs.map((org) => {
            const isSelecting = selectedOrgId === org.id && select.isPending;
            return (
              <Card key={org.id} className="transition hover:border-foreground/20">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{org.name}</p>
                      <p className="text-xs text-muted-foreground">Rôle : {org.role}</p>
                    </div>
                  </div>
                  <Button
                    onClick={() => void handleSelect(org.id)}
                    disabled={select.isPending}
                  >
                    {isSelecting ? 'Sélection…' : 'Sélectionner'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}

          <Button asChild variant="outline" size="lg" className="mt-2 justify-center">
            <Link href="/organizations/new">
              <Plus className="mr-2 h-4 w-4" /> Créer une autre organisation
            </Link>
          </Button>
        </div>
      )}

      {orgsQuery.error !== null && ApiError.is(orgsQuery.error) ? (
        <FormError error={orgsQuery.error} className="w-full max-w-2xl" />
      ) : null}
    </main>
  );
}
