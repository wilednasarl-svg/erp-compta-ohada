'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { OrganizationSummary, SelectOrganizationResponse } from '@/types/auth';

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
      setSelectedOrgId(null);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-2xl animate-page-in space-y-8">
        <header className="text-center">
          <p className="eyebrow mb-2">ERP Compta OHADA</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Choisissez votre organisation
          </h1>
          <p className="mt-3 text-sm text-ink-mute">
            Sélectionnez l'organisation sur laquelle vous souhaitez travailler. Vous pourrez en
            changer à tout moment depuis le menu utilisateur.
          </p>
        </header>

        <FormError error={select.error} />

        {orgsQuery.isLoading && orgs.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-mute">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            Chargement…
          </div>
        ) : orgs.length === 0 ? (
          <div className="rounded-sm border border-line bg-paper p-8 text-center">
            <Building2 className="mx-auto mb-4 h-10 w-10 text-ink-mute opacity-30" strokeWidth={1} />
            <p className="font-display text-lg font-medium text-ink">Aucune organisation</p>
            <p className="mt-1 text-sm text-ink-mute">
              Créez votre première organisation pour commencer à utiliser ERP Compta.
            </p>
            <Button asChild size="lg" className="mt-6">
              <Link href="/organizations/new">
                <Plus className="mr-2 h-4 w-4" /> Créer une organisation
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {orgs.map((org) => {
              const isSelecting = selectedOrgId === org.id && select.isPending;
              return (
                <div
                  key={org.id}
                  className="flex items-center justify-between gap-4 rounded-sm border border-line bg-paper px-5 py-4 transition-colors hover:border-accent/40"
                >
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 shrink-0 text-ink-mute" strokeWidth={1.5} />
                    <div>
                      <p className="font-medium text-ink">{org.name}</p>
                      <p className="text-xs text-ink-mute">Rôle : {org.role}</p>
                    </div>
                  </div>
                  <Button
                    className="press shrink-0"
                    onClick={() => void handleSelect(org.id)}
                    disabled={select.isPending}
                  >
                    {isSelecting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {isSelecting ? 'Sélection…' : 'Sélectionner'}
                  </Button>
                </div>
              );
            })}

            <Button asChild variant="outline" size="lg" className="mt-2 w-full justify-center">
              <Link href="/organizations/new">
                <Plus className="mr-2 h-4 w-4" /> Créer une autre organisation
              </Link>
            </Button>
          </div>
        )}

        {orgsQuery.error !== null && ApiError.is(orgsQuery.error) ? (
          <FormError error={orgsQuery.error} />
        ) : null}
      </div>
    </main>
  );
}
