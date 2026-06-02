'use client';

import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ApiError, api } from '@/lib/api-client';
import type {
  ListSyscohadaDomainsResponse,
  SearchSyscohadaKnowledgeResponse,
  SyscohadaControlSeverity,
  SyscohadaControlWithEvidence,
  SyscohadaModuleGuidance,
  SyscohadaSearchResult,
} from '@/types/syscohada-knowledge';

const SEVERITY_META: Record<
  SyscohadaControlSeverity,
  { readonly label: string; readonly className: string }
> = {
  blocking: { label: 'Bloquant', className: 'bg-critical-soft text-critical-ink' },
  warning: { label: 'À corriger', className: 'bg-warn-soft text-warn-ink' },
  info: { label: 'Bonne pratique', className: 'bg-info-soft text-info-ink' },
};

/**
 * Libellés FR de tous les domaines doctrinaux. Keyé `string` (et non
 * `Record<SyscohadaDomain, …>`) à dessein : le backend sert plus de domaines
 * que le type frontend n'en déclare (dérive openapi connue). Un domaine
 * inconnu retombe sur `humanizeDomain` au lieu d'afficher `undefined`.
 */
const DOMAIN_LABELS: Record<string, string> = {
  'accounting-plan': 'Plan comptable',
  journals: 'Journaux et écritures',
  assets: 'Immobilisations',
  inventory: 'Inventaire et stocks',
  tva: 'TVA et fiscalité',
  reports: 'États financiers',
  leases: 'Contrats de location',
  provisions: 'Provisions',
  impairments: 'Dépréciations',
  subsidies: 'Subventions',
  'actuarial-commitments': 'Engagements actuariels',
  regularizations: 'Régularisations',
  'business-combinations': 'Fusions et regroupements',
  'bills-of-exchange': 'Effets de commerce',
  'multi-currency': 'Multi-devises',
  'pledged-assets': 'Actifs nantis',
  'cash-flow': 'Tableau des flux de trésorerie',
  'bank-reconciliation': 'Rapprochement bancaire',
  ai: 'Assistance métier',
};

function domainLabel(domain: string): string {
  return DOMAIN_LABELS[domain] ?? humanizeDomain(domain);
}

function humanizeDomain(domain: string): string {
  const s = domain.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function SyscohadaKnowledgePage() {
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const domainsQuery = useQuery<ReadonlyArray<SyscohadaModuleGuidance>, ApiError>({
    queryKey: ['syscohada-knowledge', 'domains'],
    queryFn: async () => {
      const data = await api.get<ListSyscohadaDomainsResponse>('/syscohada-knowledge/domains');
      return data.domains;
    },
  });

  const searchQuery = useQuery<ReadonlyArray<SyscohadaSearchResult>, ApiError>({
    queryKey: ['syscohada-knowledge', 'search', selectedDomain, submittedQuery],
    queryFn: async () => {
      const params = new URLSearchParams({ query: submittedQuery, limit: '6' });
      if (selectedDomain !== 'all') params.set('domain', selectedDomain);
      const data = await api.get<SearchSyscohadaKnowledgeResponse>(
        `/syscohada-knowledge/search?${params.toString()}`,
      );
      return data.results;
    },
    enabled: submittedQuery.trim().length > 0,
  });

  const domains = useMemo(() => domainsQuery.data ?? [], [domainsQuery.data]);
  const selectedGuidance = useMemo(() => {
    if (selectedDomain === 'all') return domains;
    return domains.filter((d) => d.domain === selectedDomain);
  }, [domains, selectedDomain]);

  const submitSearch = () => setSubmittedQuery(query.trim());

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header className="border-b border-line pb-4">
          <p className="eyebrow mb-2">Référentiel métier</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Doctrine SYSCOHADA
          </h1>
          <p className="mt-2 max-w-prose text-sm text-ink-soft">
            Base de connaissance issue du Guide d&apos;application SYSCOHADA, organisée par module.
            Chaque contrôle porte sa base légale et un extrait verbatim sourcé du Guide.
          </p>
        </header>

        <section className="grid gap-8 lg:grid-cols-[240px_1fr]">
          {/* ─── Navigation par module ─────────────────────────── */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <p className="eyebrow mb-2">Modules</p>
            <nav className="space-y-0.5">
              <DomainLink
                active={selectedDomain === 'all'}
                label="Tous les modules"
                count={domains.length}
                onClick={() => setSelectedDomain('all')}
                lead={<BookOpenCheck className="size-4 shrink-0" strokeWidth={1.5} />}
              />
              {domains.map((domain) => (
                <DomainLink
                  key={domain.domain}
                  active={selectedDomain === domain.domain}
                  label={domainLabel(domain.domain)}
                  count={domain.controls.length}
                  onClick={() => setSelectedDomain(domain.domain)}
                />
              ))}
            </nav>
          </aside>

          {/* ─── Contenu ───────────────────────────────────────── */}
          <div className="min-w-0 space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-mute"
                  strokeWidth={1.5}
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitSearch();
                  }}
                  placeholder="Rechercher une règle, un contrôle, une écriture…"
                  className="pl-9"
                  aria-label="Rechercher dans la doctrine"
                />
              </div>
              <Button type="button" className="press" onClick={submitSearch}>
                <Search className="mr-2 size-4" strokeWidth={1.5} />
                Rechercher
              </Button>
            </div>

            {/* Résultats de recherche sourcés */}
            {submittedQuery !== '' && (
              <section className="space-y-3">
                <div className="flex items-baseline justify-between border-b border-line pb-2">
                  <h2 className="font-display text-lg font-medium text-ink">Résultats sourcés</h2>
                  <span className="text-xs text-ink-mute">
                    « {submittedQuery} » · {searchQuery.data?.length ?? 0} citation
                    {(searchQuery.data?.length ?? 0) > 1 ? 's' : ''}
                  </span>
                </div>
                {searchQuery.isLoading ? (
                  <CitationSkeleton />
                ) : searchQuery.error ? (
                  <ErrorBlock message={`Recherche indisponible : ${searchQuery.error.message}`} />
                ) : (searchQuery.data?.length ?? 0) === 0 ? (
                  <EmptyHint
                    title="Aucune citation trouvée"
                    hint={`Le Guide SYSCOHADA embarqué ne contient aucun passage pour « ${submittedQuery} »${
                      selectedDomain !== 'all' ? ` dans le module ${domainLabel(selectedDomain)}` : ''
                    }. Essayez d'élargir à « Tous les modules » ou d'autres mots-clés.`}
                  />
                ) : (
                  <div className="space-y-3">
                    {(searchQuery.data ?? []).map((result) => (
                      <CitationCard
                        key={`${result.sourceFile}-${result.lineStart}`}
                        result={result}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Guidance par module */}
            {domainsQuery.isLoading ? (
              <ModuleSkeleton />
            ) : domainsQuery.error ? (
              <ErrorBlock
                message={`Impossible de charger la base SYSCOHADA : ${domainsQuery.error.message}`}
              />
            ) : selectedGuidance.length === 0 ? (
              <EmptyHint
                title="Module sans doctrine"
                hint="Aucune référence n'est encore rattachée à ce module dans le Guide embarqué."
              />
            ) : (
              <div className="space-y-6">
                {selectedGuidance.map((guidance) => (
                  <ModuleCard key={guidance.domain} guidance={guidance} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

/* ─── Navigation ─────────────────────────────────────────────────── */

function DomainLink({
  active,
  label,
  count,
  onClick,
  lead,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  lead?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm transition-colors duration-fast',
        active
          ? 'bg-accent-soft font-medium text-accent-ink'
          : 'text-ink-soft hover:bg-sunk hover:text-ink',
      )}
    >
      {lead}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            'shrink-0 font-mono text-xs tabular-nums',
            active ? 'text-accent-ink' : 'text-ink-mute',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ─── Carte de module (cards non imbriquées) ─────────────────────── */

function ModuleCard({ guidance }: { readonly guidance: SyscohadaModuleGuidance }) {
  const tomes = [...new Set(guidance.references.map((r) => r.tome))].sort((a, b) => a - b);
  return (
    <article className="rounded-md border border-line bg-paper">
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <p className="eyebrow mb-1">Module</p>
          <h2 className="font-display text-xl font-medium text-ink">
            {domainLabel(guidance.domain)}
          </h2>
        </div>
        {tomes.length > 0 && (
          <span className="shrink-0 rounded-xs bg-sunk px-2 py-0.5 text-2xs font-medium uppercase tracking-wider text-ink-mute">
            Tome {tomes.join(', ')}
          </span>
        )}
      </header>

      {/* Références — liste plate, pas de cards imbriquées */}
      {guidance.references.length > 0 && (
        <div className="divide-y divide-line border-b border-line">
          {guidance.references.map((reference) => (
            <div key={`${reference.domain}-${reference.topic}`} className="px-5 py-3">
              <p className="text-sm font-medium text-ink">{reference.topic}</p>
              <p className="mt-1 text-xs text-ink-mute">
                <span className="text-ink-soft">Mots-clés :</span> {reference.keywords.join(' · ')}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Contrôles — rangs plats avec sévérité + citation en bloc indenté */}
      {guidance.controls.length > 0 && (
        <div className="px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-4 text-ink-mute" strokeWidth={1.5} />
            <span className="eyebrow">Contrôles &amp; validations ({guidance.controls.length})</span>
          </div>
          <div className="space-y-4">
            {guidance.controls.map((control) => (
              <ControlRow key={control.id} control={control} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function ControlRow({ control }: { readonly control: SyscohadaControlWithEvidence }) {
  const severity = SEVERITY_META[control.severity];
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink">{control.label}</p>
        <span
          className={cn(
            'shrink-0 rounded-xs px-2 py-0.5 text-2xs font-medium uppercase tracking-wider',
            severity.className,
          )}
        >
          {severity.label}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-soft">{control.description}</p>
      {control.legalBasis.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {control.legalBasis.map((basis) => (
            <span
              key={basis}
              className="rounded-xs bg-sunk px-1.5 py-0.5 text-2xs text-ink-mute"
            >
              {basis}
            </span>
          ))}
        </div>
      )}
      {control.citation && (
        <blockquote className="mt-2 rounded-xs bg-sunk px-3 py-2">
          <p className="text-xs italic text-ink-soft">
            « {control.citation.excerpt.slice(0, 200)}
            {control.citation.excerpt.length > 200 ? '…' : ''} »
          </p>
          <p className="mt-1 text-2xs text-ink-mute">
            {control.citation.tome > 0 ? `Tome ${control.citation.tome}, ${control.citation.sourceTitle}` : control.citation.sourceTitle} · lignes{' '}
            {control.citation.lineStart}-{control.citation.lineEnd}
          </p>
        </blockquote>
      )}
    </div>
  );
}

/* ─── Citation (résultat de recherche, top-level) ────────────────── */

function CitationCard({ result }: { readonly result: SyscohadaSearchResult }) {
  return (
    <article className="rounded-md border border-line bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs uppercase tracking-wider text-ink-mute">
        <span className="font-medium text-ink">{result.tome > 0 ? `Tome ${result.tome}` : 'Acte uniforme'}</span>
        <span aria-hidden>·</span>
        <span>{result.sourceTitle}</span>
        <span aria-hidden>·</span>
        <span className="font-mono normal-case tracking-normal">
          lignes {result.lineStart}-{result.lineEnd}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink">{result.excerpt}</p>
    </article>
  );
}

/* ─── États (vide / erreur / chargement) ─────────────────────────── */

function EmptyHint({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-md border border-line bg-paper px-6 py-10 text-center">
      <p className="font-display text-base font-medium text-ink">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-mute">{hint}</p>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-critical/30 bg-critical-soft px-5 py-4 text-sm text-critical-ink">
      {message}
    </div>
  );
}

function ModuleSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-md border border-line bg-paper">
          <div className="border-b border-line px-5 py-4">
            <div className="h-3 w-16 rounded-xs bg-sunk" />
            <div className="mt-2 h-5 w-48 rounded-xs bg-sunk" />
          </div>
          <div className="space-y-3 px-5 py-4">
            <div className="h-3.5 w-3/4 rounded-xs bg-sunk" />
            <div className="h-3.5 w-2/3 rounded-xs bg-sunk" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CitationSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-md border border-line bg-paper px-4 py-3">
          <div className="h-3 w-40 rounded-xs bg-sunk" />
          <div className="mt-2 h-3.5 w-full rounded-xs bg-sunk" />
          <div className="mt-1.5 h-3.5 w-5/6 rounded-xs bg-sunk" />
        </div>
      ))}
    </div>
  );
}
