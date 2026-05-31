'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, Loader2, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import type { OrganizationSummary, SelectOrganizationResponse } from '@/types/auth';

/* ─── Rôles ──────────────────────────────────────────────────── */

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

/**
 * Couleur d'avatar déterministe (calme : vert / bleu / ocre / neutre, jamais
 * de rouge). Un dossier garde toujours la même teinte → reconnaissance visuelle
 * immédiate, donc moins de charge cognitive pour s'y retrouver.
 */
const AVATAR_TINTS: ReadonlyArray<string> = [
  'bg-accent-soft text-accent-ink',
  'bg-info-soft text-info-ink',
  'bg-warn-soft text-warn-ink',
  'bg-sunk text-ink-soft',
];

function avatarTint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length]!;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

/* ─── Data ───────────────────────────────────────────────────── */

async function fetchMyOrganizations(): Promise<ReadonlyArray<OrganizationSummary>> {
  const result = await api.get<{ organizations: ReadonlyArray<OrganizationSummary> }>('/organizations');
  return result.organizations;
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function OrganizationsPage() {
  const router = useRouter();
  const setOrg = useAuthStore((s) => s.setOrg);
  const seededOrgs = useAuthStore((s) => s.organizations);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const orgsQuery = useQuery({
    queryKey: ['my-organizations'],
    queryFn: fetchMyOrganizations,
    initialData: seededOrgs,
  });

  const select = useApiMutation((organizationId: string) =>
    api.post<SelectOrganizationResponse>('/auth/select-organization', { organizationId }),
  );

  const orgs = useMemo(() => orgsQuery.data ?? [], [orgsQuery.data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? orgs.filter((o) => o.name.toLowerCase().includes(q)) : orgs;
  }, [orgs, search]);

  const showSearch = orgs.length > 6;

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
    <main className="flex min-h-screen flex-col bg-canvas px-4 py-12 sm:py-16">
      <div className="mx-auto w-full max-w-5xl animate-page-in space-y-8">
        {/* ── En-tête ───────────────────────────────────────── */}
        <header>
          <div className="mb-6 flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-xs bg-ink font-mono text-2xs font-semibold text-canvas">
              EC
            </span>
            <span className="font-display text-base font-medium text-ink">Compta OHADA</span>
          </div>
          <p className="eyebrow">Espace de travail</p>
          <h1 className="mt-1.5 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Choisissez votre dossier
          </h1>
          <p className="mt-2 max-w-[60ch] text-base text-ink-soft">
            Sélectionnez le dossier sur lequel travailler. Vous pourrez en changer à tout moment depuis
            le menu en haut.
          </p>
        </header>

        <FormError error={select.error} />

        {/* ── Recherche (si beaucoup de dossiers) ───────────── */}
        {showSearch && !isInitialLoading && (
          <div className="relative max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute"
              strokeWidth={1.5}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un dossier…"
              aria-label="Rechercher un dossier"
              className="h-10 w-full rounded-sm border border-line-strong bg-paper pl-9 pr-3 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
            />
          </div>
        )}

        {/* ── Corps ─────────────────────────────────────────── */}
        {isInitialLoading ? (
          <SkeletonGrid n={6} />
        ) : orgs.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((org) => (
                <OrgCard
                  key={org.id}
                  org={org}
                  isSelecting={selectedOrgId === org.id && select.isPending}
                  disabled={select.isPending}
                  onSelect={() => void handleSelect(org.id)}
                />
              ))}
              {search.trim() === '' && <NewDossierCard />}
            </div>
            {filtered.length === 0 && (
              <p className="text-sm text-ink-mute">
                Aucun dossier ne correspond à «&nbsp;{search.trim()}&nbsp;».
              </p>
            )}
          </>
        )}

        {orgsQuery.error !== null && ApiError.is(orgsQuery.error) ? (
          <FormError error={orgsQuery.error} />
        ) : null}
      </div>
    </main>
  );
}

/* ─── Carte dossier ──────────────────────────────────────────── */

interface OrgCardProps {
  readonly org: OrganizationSummary;
  readonly isSelecting: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}

function OrgCard({ org, isSelecting, disabled, onSelect }: OrgCardProps) {
  const roleClass = ROLE_CLASS[org.role] ?? 'bg-sunk text-ink-soft';
  const roleLabel = ROLE_LABEL[org.role] ?? org.role;
  const initials = initialsOf(org.name);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className="press group flex min-h-[150px] flex-col rounded-md border border-line bg-paper p-5 text-left transition-colors duration-fast hover:border-line-strong hover:bg-sunk/40 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-md font-mono text-sm font-semibold',
            avatarTint(org.name),
          )}
        >
          {initials || <Building2 className="h-5 w-5" strokeWidth={1.5} />}
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-wider', roleClass)}>
          {roleLabel}
        </span>
      </div>

      <p className="mt-4 truncate text-base font-medium text-ink" title={org.name}>
        {org.name}
      </p>

      <div className="mt-auto pt-3">
        {isSelecting ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-mute">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            Ouverture…
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-accent-ink">
            Ouvrir le dossier
            <ArrowRight
              className="h-3.5 w-3.5 transition-transform duration-fast group-hover:translate-x-0.5"
              strokeWidth={1.75}
            />
          </span>
        )}
      </div>
    </button>
  );
}

/* ─── Carte « Nouveau dossier » ──────────────────────────────── */

function NewDossierCard() {
  return (
    <Link
      href="/organizations/new"
      className="press group flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-strong p-5 text-center transition-colors duration-fast hover:border-accent hover:bg-accent-soft/40"
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-md bg-sunk text-ink-soft transition-colors duration-fast group-hover:bg-accent-soft group-hover:text-accent-ink">
        <Plus className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <span className="text-sm font-medium text-ink">Nouveau dossier</span>
      <span className="text-xs text-ink-mute">Créer ou rejoindre</span>
    </Link>
  );
}

/* ─── Skeleton ───────────────────────────────────────────────── */

function SkeletonGrid({ n = 6 }: { n?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex min-h-[150px] flex-col rounded-md border border-line bg-paper p-5">
          <div className="flex items-start justify-between">
            <div className="h-12 w-12 animate-pulse rounded-md bg-sunk" />
            <div className="h-4 w-16 animate-pulse rounded-full bg-sunk" />
          </div>
          <div className="mt-4 h-4 w-36 animate-pulse rounded-xs bg-sunk" />
          <div className="mt-auto pt-3">
            <div className="h-3 w-24 animate-pulse rounded-xs bg-sunk" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── État vide ──────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="rounded-md border border-line bg-paper px-6 py-16 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
        <Building2 className="h-6 w-6" strokeWidth={1.5} />
      </span>
      <p className="mt-5 font-display text-xl text-ink">Aucun dossier pour le moment</p>
      <p className="mx-auto mt-2 max-w-[44ch] text-sm text-ink-soft">
        Créez votre premier dossier client, ou rejoignez-en un sur invitation, pour commencer à
        travailler.
      </p>
      <Link
        href="/organizations/new"
        className="press mt-6 inline-flex items-center gap-2 rounded-sm bg-accent px-5 py-2.5 text-sm font-medium text-[oklch(98%_0.004_85)] transition-colors duration-fast hover:opacity-90"
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} />
        Créer un dossier
      </Link>
    </div>
  );
}
