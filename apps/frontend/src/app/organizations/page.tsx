'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, Loader2, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import type { OrganizationSummary, SelectOrganizationResponse } from '@/types/auth';

/* ─── Role chips ─────────────────────────────────────────────── */

const ROLE_CLASS: Record<string, string> = {
  admin: 'bg-critical-soft text-critical-ink',
  expert_comptable: 'bg-accent-soft text-accent-ink',
  chef_mission: 'bg-info-soft text-info-ink',
  comptable: 'bg-sunk text-ink-soft',
  auditeur: 'bg-warn-soft text-warn-ink',
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  expert_comptable: 'Expert-comptable',
  chef_mission: 'Chef de mission',
  comptable: 'Comptable',
  auditeur: 'Auditeur',
};

/* ─── Data ───────────────────────────────────────────────────── */

async function fetchMyOrganizations(): Promise<ReadonlyArray<OrganizationSummary>> {
  const result = await api.get<{ organizations: ReadonlyArray<OrganizationSummary> }>(
    '/organizations',
  );
  return result.organizations;
}

/* ─── Page ───────────────────────────────────────────────────── */

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

  const isInitialLoading = orgsQuery.isLoading && orgs.length === 0;

  return (
    <main className="flex min-h-screen flex-col bg-canvas px-4 py-12">
      <div className="mx-auto w-full max-w-2xl animate-page-in space-y-8">
        {/* ── Header ───────────────────────────────────────── */}
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xs bg-ink font-mono text-2xs font-semibold text-canvas">
              EC
            </span>
            <span className="font-display text-base font-medium text-ink">
              Compta OHADA
            </span>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Organisations</p>
              <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">
                Choisissez votre organisation
              </h1>
              <p className="mt-2 max-w-[60ch] text-sm text-ink-soft">
                Sélectionnez le dossier sur lequel vous souhaitez travailler. Vous
                pourrez en changer à tout moment depuis le menu utilisateur.
              </p>
            </div>
            {orgs.length > 0 && (
              <Link
                href="/organizations/new"
                className="press inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm font-medium text-ink transition-colors duration-fast hover:bg-sunk"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Nouvelle organisation
              </Link>
            )}
          </div>
        </header>

        <FormError error={select.error} />

        {/* ── Body ─────────────────────────────────────────── */}
        {isInitialLoading ? (
          <div className="rounded-sm border border-line bg-paper">
            <SkeletonRows n={3} />
          </div>
        ) : orgs.length === 0 ? (
          <div className="rounded-sm border border-line bg-paper">
            <EmptyState
              icon={Building2}
              title="Aucune organisation"
              description="Créez ou rejoignez une organisation pour commencer à utiliser ERP Compta."
              actionLabel="Créer une organisation"
              actionHref="/organizations/new"
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-sm border border-line bg-paper">
            <ul className="divide-y divide-line">
              {orgs.map((org) => (
                <OrgRow
                  key={org.id}
                  org={org}
                  isSelecting={selectedOrgId === org.id && select.isPending}
                  disabled={select.isPending}
                  onSelect={() => void handleSelect(org.id)}
                />
              ))}
            </ul>
          </div>
        )}

        {orgsQuery.error !== null && ApiError.is(orgsQuery.error) ? (
          <FormError error={orgsQuery.error} />
        ) : null}
      </div>
    </main>
  );
}

/* ─── Row ────────────────────────────────────────────────────── */

interface OrgRowProps {
  readonly org: OrganizationSummary;
  readonly isSelecting: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}

function OrgRow({ org, isSelecting, disabled, onSelect }: OrgRowProps) {
  const roleClass = ROLE_CLASS[org.role] ?? 'bg-sunk text-ink-soft';
  const roleLabel = ROLE_LABEL[org.role] ?? org.role;
  const initials = org.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="press group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors duration-fast hover:bg-sunk disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-sunk font-mono text-xs font-semibold text-ink-soft">
          {initials || <Building2 className="h-4 w-4" strokeWidth={1.5} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{org.name}</p>
          <p className="mt-0.5 text-2xs text-ink-mute">Cliquez pour ouvrir le dossier</p>
        </div>
        <span
          className={`hidden shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium sm:inline-flex ${roleClass}`}
        >
          {roleLabel}
        </span>
        <span className="ml-1 flex shrink-0 items-center text-ink-mute">
          {isSelecting ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <ArrowRight
              className="h-4 w-4 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-ink"
              strokeWidth={1.5}
            />
          )}
        </span>
      </button>
    </li>
  );
}

/* ─── Skeleton ───────────────────────────────────────────────── */

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <div className="h-10 w-10 rounded-sm bg-sunk" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-40 rounded-xs bg-sunk" />
            <div className="h-2.5 w-28 rounded-xs bg-sunk" />
          </div>
          <div className="h-5 w-24 rounded-full bg-sunk" />
        </div>
      ))}
    </div>
  );
}

/* ─── Empty state ────────────────────────────────────────────── */

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
      </div>
      {actionLabel !== undefined && actionHref !== undefined && (
        <Link
          href={actionHref}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          <Plus className="h-3 w-3" strokeWidth={1.5} />
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
