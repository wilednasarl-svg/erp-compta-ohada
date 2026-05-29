'use client';

import { useQuery } from '@tanstack/react-query';
import { BookOpenCheck, FileSearch, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';
import type {
  ListSyscohadaDomainsResponse,
  SearchSyscohadaKnowledgeResponse,
  SyscohadaControlSeverity,
  SyscohadaControlWithEvidence,
  SyscohadaDomain,
  SyscohadaModuleGuidance,
  SyscohadaSearchResult,
} from '@/types/syscohada-knowledge';

const SEVERITY_META: Record<
  SyscohadaControlSeverity,
  { readonly label: string; readonly className: string }
> = {
  blocking: { label: 'Bloquant', className: 'border-critical/40 bg-critical-soft text-critical-ink' },
  warning: { label: 'À corriger', className: 'border-warn/40 bg-warn-soft text-warn-ink' },
  info: { label: 'Bonne pratique', className: 'border-info/40 bg-info-soft text-info-ink' },
};

const DOMAIN_LABELS: Record<SyscohadaDomain, string> = {
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
  'actuarial-commitments': 'Engagements de retraite',
  regularizations: 'Régularisations',
  'business-combinations': 'Fusions et regroupements',
  'bills-of-exchange': 'Effets de commerce',
  'multi-currency': 'Multi-devises',
  'pledged-assets': 'Sûretés et nantissements',
  'cash-flow': 'Flux de trésorerie',
  'bank-reconciliation': 'Rapprochement bancaire',
  ai: 'Assistance métier',
};

export default function SyscohadaKnowledgePage() {
  const [selectedDomain, setSelectedDomain] = useState<SyscohadaDomain | 'all'>('all');
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

  const domains = domainsQuery.data ?? [];
  const selectedGuidance = useMemo(() => {
    if (selectedDomain === 'all') return domains;
    return domains.filter((d) => d.domain === selectedDomain);
  }, [domains, selectedDomain]);

  const submitSearch = () => {
    setSubmittedQuery(query.trim());
  };

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-8">
        <header className="border-b border-line pb-4">
          <p className="eyebrow mb-2">Référentiel métier</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Doctrine SYSCOHADA
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-ink-mute">
            Base de connaissance issue des PDF du Guide d’application SYSCOHADA, exposée par
            domaine pour renforcer les contrôles, validations, écrans et exports.
          </p>
        </header>

        <section className="grid gap-3 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-2">
            <Button
              type="button"
              variant={selectedDomain === 'all' ? 'default' : 'outline'}
              className="w-full justify-start"
              onClick={() => setSelectedDomain('all')}
            >
              <BookOpenCheck className="h-4 w-4" />
              Tous les modules
            </Button>
            {domains.map((domain) => (
              <Button
                key={domain.domain}
                type="button"
                variant={selectedDomain === domain.domain ? 'default' : 'outline'}
                className="w-full justify-start"
                onClick={() => setSelectedDomain(domain.domain)}
              >
                <FileSearch className="h-4 w-4" />
                {DOMAIN_LABELS[domain.domain]}
              </Button>
            ))}
          </aside>

          <div className="space-y-5">
            <div className="rounded-md border border-line bg-paper p-4">
              <div className="flex flex-col gap-3 md:flex-row">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitSearch();
                  }}
                  placeholder="Rechercher une règle, un état, un contrôle, une écriture..."
                />
                <Button type="button" onClick={submitSearch}>
                  <Search className="h-4 w-4" />
                  Rechercher
                </Button>
              </div>
            </div>

            {domainsQuery.isLoading ? (
              <div className="rounded-md border border-line bg-paper p-6 text-sm text-ink-mute">
                Chargement du référentiel SYSCOHADA...
              </div>
            ) : domainsQuery.error ? (
              <div className="rounded-md border border-critical/30 bg-critical-soft p-6 text-sm text-critical-ink">
                Impossible de charger la base SYSCOHADA: {domainsQuery.error.message}
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {selectedGuidance.map((guidance) => (
                  <ModuleCard key={guidance.domain} guidance={guidance} />
                ))}
              </div>
            )}

            {submittedQuery !== '' && (
              <section className="space-y-3">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <h2 className="text-lg font-semibold text-ink">Résultats sourcés</h2>
                  <span className="text-xs text-ink-mute">
                    {searchQuery.data?.length ?? 0} citation(s)
                  </span>
                </div>
                {searchQuery.isLoading ? (
                  <div className="rounded-md border border-line bg-paper p-5 text-sm text-ink-mute">
                    Recherche dans le Guide SYSCOHADA...
                  </div>
                ) : searchQuery.error ? (
                  <div className="rounded-md border border-critical/30 bg-critical-soft p-5 text-sm text-critical-ink">
                    Recherche indisponible: {searchQuery.error.message}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(searchQuery.data ?? []).map((result) => (
                      <CitationCard key={`${result.sourceFile}-${result.lineStart}`} result={result} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function ModuleCard({ guidance }: { readonly guidance: SyscohadaModuleGuidance }) {
  return (
    <article className="rounded-md border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Module</p>
          <h2 className="text-xl font-semibold text-ink">{DOMAIN_LABELS[guidance.domain]}</h2>
        </div>
        <span className="rounded-sm border border-line px-2 py-1 text-xs text-ink-mute">
          Tome {guidance.references.map((r) => r.tome).join(', ')}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {guidance.references.map((reference) => (
          <div key={`${reference.domain}-${reference.topic}`} className="text-sm">
            <p className="font-medium text-ink">{reference.topic}</p>
            <p className="mt-1 text-xs text-ink-mute">
              Mots-clés: {reference.keywords.join(', ')}
            </p>
          </div>
        ))}
      </div>

      {guidance.controls.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">
            <ShieldCheck className="h-4 w-4" />
            Contrôles &amp; validations ({guidance.controls.length})
          </div>
          <div className="space-y-2">
            {guidance.controls.map((control) => (
              <ControlCard key={control.id} control={control} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 space-y-3">
        {guidance.evidence.map((result) => (
          <CitationCard key={`${result.sourceFile}-${result.lineStart}`} result={result} compact />
        ))}
      </div>
    </article>
  );
}

function ControlCard({ control }: { readonly control: SyscohadaControlWithEvidence }) {
  const severity = SEVERITY_META[control.severity];
  return (
    <article className="rounded-md border border-line bg-sunk p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink">{control.label}</p>
        <span className={`shrink-0 rounded-sm border px-2 py-0.5 text-[11px] ${severity.className}`}>
          {severity.label}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-mute">{control.description}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {control.legalBasis.map((basis) => (
          <span
            key={basis}
            className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-ink-mute"
          >
            {basis}
          </span>
        ))}
      </div>
      {control.citation && (
        <p className="mt-2 border-l-2 border-line pl-2 text-[11px] italic text-ink-mute">
          « {control.citation.excerpt.slice(0, 180)}
          {control.citation.excerpt.length > 180 ? '…' : ''} » — Tome {control.citation.tome},{' '}
          {control.citation.sourceTitle} (lignes {control.citation.lineStart}-
          {control.citation.lineEnd})
        </p>
      )}
    </article>
  );
}

function CitationCard({
  result,
  compact = false,
}: {
  readonly result: SyscohadaSearchResult;
  readonly compact?: boolean;
}) {
  return (
    <article className="rounded-md border border-line bg-sunk p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
        <span className="font-semibold text-ink">Tome {result.tome}</span>
        <span>{result.sourceTitle}</span>
        <span>
          lignes {result.lineStart}-{result.lineEnd}
        </span>
      </div>
      <p className={compact ? 'mt-2 line-clamp-3 text-sm text-ink' : 'mt-3 text-sm text-ink'}>
        {result.excerpt}
      </p>
    </article>
  );
}
