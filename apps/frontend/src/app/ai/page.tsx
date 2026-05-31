'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Brain,
  Columns3,
  Lightbulb,
  Loader2,
  MessageCircle,
  Play,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';

type AnomalyType =
  | 'extreme_amount'
  | 'sensitive_account'
  | 'potential_duplicate'
  | 'suspicious_date'
  | 'rare_account_journal';

const ANOMALY_TYPE_LABELS: Readonly<Record<AnomalyType, string>> = {
  extreme_amount: 'Montant extrême',
  sensitive_account: 'Compte sensible',
  potential_duplicate: 'Doublon potentiel',
  suspicious_date: 'Date suspecte',
  rare_account_journal: 'Combinaison rare',
};

interface AiAnomaly {
  readonly id: string;
  readonly periodId: string | null;
  readonly entryId: string | null;
  readonly accountId: string | null;
  readonly anomalyType: AnomalyType;
  readonly riskScore: number;
  readonly reasons: ReadonlyArray<string>;
  readonly detectedBy: string;
  readonly detectedAt: string;
  readonly createdAt: string;
}

interface AnomaliesResponse {
  readonly anomalies: ReadonlyArray<AiAnomaly>;
  readonly meta: {
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
  };
}

interface ScanStats {
  readonly periodId: string;
  readonly entriesScanned: number;
  readonly linesScanned: number;
  readonly anomaliesDetected: number;
  readonly durationMs: number;
}

interface PeriodsResponse {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
}

interface SuggestionResult {
  readonly suggestion: {
    readonly suggestedAccountCode: string;
    readonly confidence: number;
    readonly reasons: ReadonlyArray<string>;
    readonly alternative?: {
      readonly accountCode: string;
      readonly confidence: number;
      readonly reasons: ReadonlyArray<string>;
    };
  } | null;
}

const SELECT_CLASS =
  'flex h-9 rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none';

/* ─── Severity helpers ────────────────────────────────────────────── */

type Severity = 'critical' | 'warn' | 'info';

function severityFromScore(score: number): Severity {
  if (score >= 70) return 'critical';
  if (score >= 40) return 'warn';
  return 'info';
}

function severityChip(sev: Severity): string {
  if (sev === 'critical') return 'bg-critical-soft text-critical-ink';
  if (sev === 'warn') return 'bg-warn-soft text-warn-ink';
  return 'bg-info-soft text-info-ink';
}

function severityLabel(sev: Severity): string {
  if (sev === 'critical') return 'Critique';
  if (sev === 'warn') return 'Alerte';
  return 'Info';
}

function severityDot(sev: Severity): string {
  if (sev === 'critical') return 'bg-critical';
  if (sev === 'warn') return 'bg-warn';
  return 'bg-info';
}

/* ─── Skeleton & Empty ────────────────────────────────────────────── */

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="animate-pulse divide-y divide-line rounded-sm border border-line bg-paper">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-5 w-16 rounded-full bg-sunk" />
          <div className="h-3 flex-1 rounded-xs bg-sunk" />
          <div className="h-3 w-24 rounded-xs bg-sunk" />
        </div>
      ))}
    </div>
  );
}

function EmptyStateOk({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
        <Icon className="h-5 w-5 text-accent-ink" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[44ch] text-xs text-ink-mute">{description}</p>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[44ch] text-xs text-ink-mute">{description}</p>
      </div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────── */

export default function AiPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();

  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<AnomalyType | ''>('');
  const [minScore, setMinScore] = useState<number>(0);

  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const data = await api.get<PeriodsResponse>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return data.periods;
    },
    enabled: orgId !== '',
  });

  const anomaliesQuery = useQuery<AnomaliesResponse, ApiError>({
    queryKey: ['ai-anomalies', orgId, selectedPeriodId, typeFilter, minScore],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedPeriodId) params.set('periodId', selectedPeriodId);
      if (typeFilter) params.set('anomalyType', typeFilter);
      if (minScore > 0) params.set('minScore', String(minScore));
      params.set('pageSize', '100');
      return api.get<AnomaliesResponse>(
        `/organizations/${orgId}/ai/anomalies?${params}`,
      );
    },
    enabled: orgId !== '',
  });

  const scanMutation = useApiMutation<{ stats: ScanStats }, { periodId: string }>(
    ({ periodId }) =>
      api.post<{ stats: ScanStats }>(
        `/organizations/${orgId}/ai/anomalies/scan`,
        { periodId },
      ),
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['ai-anomalies', orgId] });
      },
    },
  );

  const annualPeriods = useMemo(() => {
    const periods = periodsQuery.data ?? [];
    return periods
      .filter((p) => p.parentId === null)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }, [periodsQuery.data]);

  const anomalies = anomaliesQuery.data?.anomalies ?? [];
  const criticalCount = anomalies.filter((a) => a.riskScore >= 70).length;
  const warnCount = anomalies.filter((a) => a.riskScore >= 40 && a.riskScore < 70).length;
  const infoCount = anomalies.filter((a) => a.riskScore < 40).length;

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-10">
        {/* ─── Header ─────────────────────────────────────── */}
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Analyse &amp; IA · Anomalies</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Détection d&apos;anomalies
            </h1>
            <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
              Analyse automatique des écritures pour détecter les incohérences, doublons
              et erreurs de classification SYSCOHADA.
            </p>
          </div>
          {criticalCount > 0 && (
            <span
              className={`inline-flex items-center gap-2 self-end rounded-full px-3 py-1.5 text-xs font-medium ${severityChip('critical')}`}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-critical opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-critical" />
              </span>
              {criticalCount} anomalie{criticalCount > 1 ? 's' : ''} critique
              {criticalCount > 1 ? 's' : ''}
            </span>
          )}
        </header>

        <Hint id="ai-intro" variant="learn">
          L&apos;IA examine vos écritures validées pour signaler les anomalies
          (montants extrêmes, doublons, comptes sensibles) et propose un mapping
          des colonnes lors des imports. Ce sont des aides à la décision : un
          signalement reste à vérifier, il ne bloque jamais une écriture.
        </Hint>

        {/* ─── Scan ───────────────────────────────────────── */}
        <ScanSection
          periods={annualPeriods}
          selectedPeriodId={selectedPeriodId}
          onPeriodChange={setSelectedPeriodId}
          onScan={() => {
            if (selectedPeriodId) scanMutation.mutate({ periodId: selectedPeriodId });
          }}
          loading={scanMutation.isPending}
          stats={scanMutation.data?.stats ?? null}
          error={scanMutation.error}
        />

        {/* ─── Anomalies ──────────────────────────────────── */}
        <AnomaliesSection
          anomalies={anomalies}
          total={anomaliesQuery.data?.meta.total ?? 0}
          critical={criticalCount}
          warn={warnCount}
          info={infoCount}
          loading={anomaliesQuery.isLoading}
          error={anomaliesQuery.error}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          minScore={minScore}
          onMinScoreChange={setMinScore}
        />

        {/* ─── Suggestion ─────────────────────────────────── */}
        <SuggestionSection orgId={orgId} />

        {/* ─── Mapping ────────────────────────────────────── */}
        <MappingSection orgId={orgId} />

        {/* ─── Assistant ──────────────────────────────────── */}
        <AssistantSection orgId={orgId} periodId={selectedPeriodId} />
      </div>
    </AppShell>
  );
}

/* ─── ScanSection ─────────────────────────────────────────────────── */

interface ScanSectionProps {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
  readonly selectedPeriodId: string;
  readonly onPeriodChange: (id: string) => void;
  readonly onScan: () => void;
  readonly loading: boolean;
  readonly stats: ScanStats | null;
  readonly error: ApiError | null;
}

function ScanSection({
  periods,
  selectedPeriodId,
  onPeriodChange,
  onScan,
  loading,
  stats,
  error,
}: ScanSectionProps) {
  return (
    <section className="rounded-sm border border-line bg-paper">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-sm bg-sunk">
          <Play className="h-4 w-4 text-ink" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-xl font-medium text-ink">
            Scanner une période
          </h2>
          <p className="mt-1 text-xs text-ink-mute">
            Recalcul complet des anomalies sur la période choisie. Les anciennes
            anomalies de la période sont effacées avant ré-insertion.
          </p>
        </div>
      </div>
      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="period-select">Période fiscale</Label>
            <select
              id="period-select"
              className={`${SELECT_CLASS} w-full`}
              value={selectedPeriodId}
              onChange={(e) => onPeriodChange(e.target.value)}
            >
              <option value="">— Toutes les anomalies déjà détectées —</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.startDate} → {p.endDate}){' '}
                  {p.status === 'closed' ? '— clôturée' : ''}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={onScan}
            disabled={loading || selectedPeriodId === ''}
            className="press md:w-44"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Lancer le scan
          </Button>
        </div>
        {error && <FormError error={{ code: error.code, message: error.message }} />}
        {stats && (
          <div className="rounded-sm border border-accent/30 bg-accent-soft px-3 py-2.5 text-sm text-accent-ink">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
              Scan terminé en {stats.durationMs} ms
            </div>
            <div className="mt-1 text-xs text-accent-ink/80">
              <span className="font-mono tabular-nums">{stats.entriesScanned}</span>{' '}
              écriture{stats.entriesScanned > 1 ? 's' : ''} ·{' '}
              <span className="font-mono tabular-nums">{stats.linesScanned}</span> ligne
              {stats.linesScanned > 1 ? 's' : ''} ·{' '}
              <span className="font-mono tabular-nums">{stats.anomaliesDetected}</span>{' '}
              anomalie{stats.anomaliesDetected > 1 ? 's' : ''} détectée
              {stats.anomaliesDetected > 1 ? 's' : ''}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── AnomaliesSection ────────────────────────────────────────────── */

interface AnomaliesSectionProps {
  readonly anomalies: ReadonlyArray<AiAnomaly>;
  readonly total: number;
  readonly critical: number;
  readonly warn: number;
  readonly info: number;
  readonly loading: boolean;
  readonly error: ApiError | null;
  readonly typeFilter: AnomalyType | '';
  readonly onTypeFilterChange: (t: AnomalyType | '') => void;
  readonly minScore: number;
  readonly onMinScoreChange: (s: number) => void;
}

function AnomaliesSection({
  anomalies,
  total,
  critical,
  warn,
  info,
  loading,
  error,
  typeFilter,
  onTypeFilterChange,
  minScore,
  onMinScoreChange,
}: AnomaliesSectionProps) {
  return (
    <section className="rounded-sm border border-line bg-paper">
      <div className="border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-sm bg-sunk">
              <AlertTriangle className="h-4 w-4 text-warn-ink" strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="font-display text-xl font-medium text-ink">
                Anomalies détectées
              </h2>
              <p className="mt-1 text-xs text-ink-mute">
                Triées par risque décroissant. Chaque ligne expose ses raisons en clair.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sunk px-2.5 py-1 font-medium text-ink-soft">
              <span className="font-mono tabular-nums">{total}</span> total
            </span>
            {critical > 0 && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${severityChip('critical')}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${severityDot('critical')}`} />
                <span className="font-mono tabular-nums">{critical}</span>
              </span>
            )}
            {warn > 0 && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${severityChip('warn')}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${severityDot('warn')}`} />
                <span className="font-mono tabular-nums">{warn}</span>
              </span>
            )}
            {info > 0 && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${severityChip('info')}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${severityDot('info')}`} />
                <span className="font-mono tabular-nums">{info}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="type-filter">Type</Label>
            <select
              id="type-filter"
              className={SELECT_CLASS}
              value={typeFilter}
              onChange={(e) =>
                onTypeFilterChange((e.target.value as AnomalyType) || '')
              }
            >
              <option value="">Tous</option>
              {(Object.keys(ANOMALY_TYPE_LABELS) as AnomalyType[]).map((t) => (
                <option key={t} value={t}>
                  {ANOMALY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="min-score">Score minimum</Label>
            <Input
              id="min-score"
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => onMinScoreChange(Number(e.target.value) || 0)}
              className="w-24"
            />
          </div>
        </div>

        {error && <FormError error={{ code: error.code, message: error.message }} />}

        {loading ? (
          <SkeletonRows n={5} />
        ) : anomalies.length === 0 ? (
          <EmptyStateOk
            icon={Brain}
            title="Aucune anomalie détectée"
            description="La comptabilité semble cohérente avec les filtres actuels."
          />
        ) : (
          <div className="divide-y divide-line rounded-sm border border-line">
            {anomalies.map((a) => (
              <AnomalyRow key={a.id} anomaly={a} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AnomalyRow({ anomaly }: { anomaly: AiAnomaly }) {
  const sev = severityFromScore(anomaly.riskScore);
  return (
    <div className="group px-4 py-3.5 transition-colors duration-fast hover:bg-sunk/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${severityChip(sev)}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${severityDot(sev)}`} />
            {severityLabel(sev)}
          </span>
          <span className="text-sm font-medium text-ink">
            {ANOMALY_TYPE_LABELS[anomaly.anomalyType]}
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-mute">
            score{' '}
            <span className="font-semibold tabular-nums text-ink-soft">
              {anomaly.riskScore}
            </span>
          </span>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-ink-mute">
          {new Date(anomaly.detectedAt).toLocaleString('fr-FR')}
        </span>
      </div>
      {anomaly.reasons.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm text-ink-soft">
          {anomaly.reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-mute" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── SuggestionSection ───────────────────────────────────────────── */

function SuggestionSection({ orgId }: { orgId: string }) {
  const [description, setDescription] = useState('');
  const [partner, setPartner] = useState('');
  const [side, setSide] = useState<'' | 'debit' | 'credit'>('');

  const suggestionMutation = useApiMutation<SuggestionResult, void>(() =>
    api.post<SuggestionResult>(`/organizations/${orgId}/ai/suggestions/entry`, {
      description,
      partner: partner || undefined,
      side: side || undefined,
    }),
  );

  return (
    <section className="rounded-sm border border-line bg-paper">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-sm bg-sunk">
          <Lightbulb className="h-4 w-4 text-warn-ink" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-xl font-medium text-ink">
            Suggestion de compte
          </h2>
          <p className="mt-1 text-xs text-ink-mute">
            Bac à sable : saisir un libellé d&apos;écriture pour voir le compte
            heuristique proposé.
          </p>
        </div>
      </div>
      <div className="space-y-4 px-5 py-5">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr_minmax(120px,auto)]">
          <div className="space-y-1.5">
            <Label htmlFor="suggest-desc">Libellé</Label>
            <Input
              id="suggest-desc"
              placeholder="Ex : Loyer bureau juin 2026"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suggest-partner">Tiers (optionnel)</Label>
            <Input
              id="suggest-partner"
              placeholder="SODECI"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="suggest-side">Sens</Label>
            <select
              id="suggest-side"
              className={`${SELECT_CLASS} w-full`}
              value={side}
              onChange={(e) => setSide(e.target.value as '' | 'debit' | 'credit')}
            >
              <option value="">—</option>
              <option value="debit">Débit</option>
              <option value="credit">Crédit</option>
            </select>
          </div>
        </div>
        <Button
          onClick={() => suggestionMutation.mutate()}
          disabled={suggestionMutation.isPending || description.trim().length === 0}
          className="press"
        >
          {suggestionMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-2 h-4 w-4" />
          )}
          Suggérer
        </Button>

        {suggestionMutation.error && (
          <FormError
            error={{
              code: suggestionMutation.error.code,
              message: suggestionMutation.error.message,
            }}
          />
        )}

        {suggestionMutation.data &&
          (suggestionMutation.data.suggestion ? (
            <div className="space-y-3 rounded-sm border border-line bg-sunk/40 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-ink">
                  Compte{' '}
                  <span className="font-mono tabular-nums">
                    {suggestionMutation.data.suggestion.suggestedAccountCode}
                  </span>
                </span>
                <span className="text-xs text-ink-soft">
                  Confiance{' '}
                  <span className="font-mono font-semibold tabular-nums text-ink">
                    {suggestionMutation.data.suggestion.confidence}
                  </span>
                  <span className="text-ink-mute"> / 100</span>
                </span>
              </div>
              <ul className="space-y-1 text-sm text-ink-soft">
                {suggestionMutation.data.suggestion.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-mute" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
              {suggestionMutation.data.suggestion.alternative && (
                <div className="border-t border-line pt-3 text-xs text-ink-mute">
                  <span className="font-medium text-ink">Alternative : </span>
                  Compte{' '}
                  <span className="font-mono tabular-nums">
                    {suggestionMutation.data.suggestion.alternative.accountCode}
                  </span>{' '}
                  · confiance{' '}
                  <span className="font-mono tabular-nums">
                    {suggestionMutation.data.suggestion.alternative.confidence}
                  </span>{' '}
                  —{' '}
                  {suggestionMutation.data.suggestion.alternative.reasons.join(' ')}
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Lightbulb}
              title="Aucune suggestion"
              description="Le libellé ne matche aucun pattern ni historique suffisant."
            />
          ))}
      </div>
    </section>
  );
}

/* ─── AssistantSection ────────────────────────────────────────────── */

interface AssistantResponse {
  readonly answer: {
    readonly answer: string;
    readonly confidence: number;
    readonly matchedIntent: string | null;
    readonly supportingData?: Record<string, unknown>;
  };
}

const SAMPLE_QUESTIONS: ReadonlyArray<string> = [
  'Quelles anomalies détectées ?',
  'Quelle est l’écriture la plus risquée ?',
  'Solde du compte 411',
  'Combien j’ai dépensé en 6132 ?',
  'Pourquoi le compte 6132 augmente ?',
];

function AssistantSection({ orgId, periodId }: { orgId: string; periodId: string }) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<
    ReadonlyArray<{ q: string; a: AssistantResponse['answer'] }>
  >([]);

  const askMutation = useApiMutation<AssistantResponse, { question: string }>(
    ({ question: q }) =>
      api.post<AssistantResponse>(`/organizations/${orgId}/ai/assistant/ask`, {
        question: q,
        periodId: periodId || undefined,
      }),
    {
      onSuccess: (data, vars) => {
        setHistory((prev) => [...prev, { q: vars.question, a: data.answer }]);
        setQuestion('');
      },
    },
  );

  return (
    <section className="rounded-sm border border-line bg-paper">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-sm bg-sunk">
          <MessageCircle className="h-4 w-4 text-info-ink" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-xl font-medium text-ink">
            Assistant comptable
          </h2>
          <p className="mt-1 text-xs text-ink-mute">
            Provider rule-based v1 — 5 patterns reconnus. Un LLM est prévu en wave 3.
          </p>
        </div>
      </div>
      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-wrap gap-2">
          {SAMPLE_QUESTIONS.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => setQuestion(sample)}
              disabled={askMutation.isPending}
              className="press rounded-full border border-line bg-sunk/40 px-3 py-1 text-xs text-ink-soft transition-colors duration-fast hover:border-line-strong hover:bg-sunk hover:text-ink disabled:opacity-50"
            >
              {sample}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Posez votre question…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && question.trim().length > 0) {
                askMutation.mutate({ question });
              }
            }}
            className="flex-1"
          />
          <Button
            onClick={() => askMutation.mutate({ question })}
            disabled={askMutation.isPending || question.trim().length === 0}
            className="press"
          >
            {askMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageCircle className="mr-2 h-4 w-4" />
            )}
            Demander
          </Button>
        </div>

        {askMutation.error && (
          <FormError
            error={{
              code: askMutation.error.code,
              message: askMutation.error.message,
            }}
          />
        )}

        {history.length > 0 && (
          <div className="space-y-3">
            {history.map((entry, i) => (
              <div
                key={i}
                className="space-y-2 rounded-sm border border-line bg-sunk/30 p-4"
              >
                <div className="text-xs font-medium uppercase tracking-wider text-ink-mute">
                  Question
                </div>
                <div className="text-sm font-medium text-ink">{entry.q}</div>
                <div className="text-xs font-medium uppercase tracking-wider text-ink-mute">
                  Réponse
                </div>
                <div className="text-sm text-ink-soft">{entry.a.answer}</div>
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  <span className="inline-flex items-center rounded-full bg-paper px-2.5 py-0.5 font-medium text-ink-soft">
                    Intent : {entry.a.matchedIntent ?? 'non reconnu'}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-paper px-2.5 py-0.5 font-medium text-ink-soft">
                    Confiance{' '}
                    <span className="ml-1 font-mono tabular-nums">
                      {entry.a.confidence}/100
                    </span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/* ─── MappingSection ──────────────────────────────────────────────── */

type TargetField =
  | 'account_code'
  | 'description'
  | 'debit'
  | 'credit'
  | 'entry_date'
  | 'journal_code'
  | 'partner'
  | 'reference';

const TARGET_FIELD_LABELS: Readonly<Record<TargetField, string>> = {
  account_code: 'Compte',
  description: 'Libellé',
  debit: 'Débit',
  credit: 'Crédit',
  entry_date: 'Date',
  journal_code: 'Journal',
  partner: 'Tiers',
  reference: 'Référence',
};

interface ColumnMapping {
  readonly sourceColumn: string;
  readonly sourceIndex: number;
  readonly targetField: TargetField | null;
  readonly confidence: number;
  readonly reason: string;
}

interface MappingSuggestionResult {
  readonly mappings: ReadonlyArray<ColumnMapping>;
  readonly coverage: number;
}

function MappingSection({ orgId }: { orgId: string }) {
  const [headersInput, setHeadersInput] = useState(
    'Date, Code journal, N° Compte, Libellé, Débit, Crédit, Tiers, N° Pièce',
  );
  const [sampleInput, setSampleInput] = useState(
    '15/06/2026; AC; 6132; Loyer juin; 750000; 0; SOCIDA; F-2026-001\n16/06/2026; AC; 6051; CIE juin; 120000; 0; CIE; F-2026-002',
  );

  const mappingMutation = useApiMutation<MappingSuggestionResult, void>(() => {
    const headers = headersInput
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const sampleRows = sampleInput
      .split('\n')
      .map((line) => line.split(/[;,]/).map((c) => c.trim()))
      .filter((row) => row.length > 0 && row.some((c) => c.length > 0));
    return api.post<MappingSuggestionResult>(
      `/organizations/${orgId}/ai/mapping/suggest-columns`,
      { headers, sampleRows },
    );
  });

  return (
    <section className="rounded-sm border border-line bg-paper">
      <div className="flex items-start gap-3 border-b border-line px-5 py-4">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-sm bg-sunk">
          <Columns3 className="h-4 w-4 text-ink" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-xl font-medium text-ink">
            Mapping IA des colonnes Sage
          </h2>
          <p className="mt-1 text-xs text-ink-mute">
            Bac à sable : coller des en-têtes Sage + quelques lignes d&apos;échantillon.
            L&apos;IA détecte chaque colonne par pattern et inférence de type.
          </p>
        </div>
      </div>
      <div className="space-y-4 px-5 py-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="headers-input">En-têtes (séparées par , ou ;)</Label>
            <Input
              id="headers-input"
              value={headersInput}
              onChange={(e) => setHeadersInput(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sample-input">
              Lignes d&apos;échantillon (une par ligne, colonnes séparées par ;)
            </Label>
            <textarea
              id="sample-input"
              value={sampleInput}
              onChange={(e) => setSampleInput(e.target.value)}
              rows={3}
              className="w-full rounded-sm border border-line-strong bg-paper px-3 py-2 font-mono text-xs text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
            />
          </div>
        </div>
        <Button
          onClick={() => mappingMutation.mutate()}
          disabled={mappingMutation.isPending || headersInput.trim().length === 0}
          className="press"
        >
          {mappingMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Columns3 className="mr-2 h-4 w-4" />
          )}
          Analyser les colonnes
        </Button>

        {mappingMutation.error && (
          <FormError
            error={{
              code: mappingMutation.error.code,
              message: mappingMutation.error.message,
            }}
          />
        )}

        {mappingMutation.data && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-sm border border-line bg-sunk/40 px-4 py-3 text-sm">
              <span className="text-xs font-medium uppercase tracking-wider text-ink-mute">
                Coverage
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                  mappingMutation.data.coverage >= 80
                    ? 'bg-accent-soft text-accent-ink'
                    : mappingMutation.data.coverage >= 50
                      ? 'bg-warn-soft text-warn-ink'
                      : 'bg-critical-soft text-critical-ink'
                }`}
              >
                <span className="font-mono tabular-nums">
                  {mappingMutation.data.coverage}
                </span>
                <span className="opacity-70"> / 100</span>
              </span>
              <span className="text-xs text-ink-mute">
                <span className="font-mono tabular-nums text-ink-soft">
                  {mappingMutation.data.mappings.filter((m) => m.targetField).length}
                </span>{' '}
                colonne(s) reconnue(s) sur{' '}
                <span className="font-mono tabular-nums text-ink-soft">
                  {mappingMutation.data.mappings.length}
                </span>
              </span>
            </div>
            <div className="overflow-hidden rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-sunk">
                    <th className="px-3 py-2 text-left">
                      <span className="eyebrow">Colonne source</span>
                    </th>
                    <th className="px-3 py-2 text-left">
                      <span className="eyebrow">Champ cible</span>
                    </th>
                    <th className="px-3 py-2 text-left">
                      <span className="eyebrow">Confiance</span>
                    </th>
                    <th className="px-3 py-2 text-left">
                      <span className="eyebrow">Raison</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {mappingMutation.data.mappings.map((m) => (
                    <tr
                      key={m.sourceIndex}
                      className="transition-colors duration-fast hover:bg-sunk/30"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-ink">
                        {m.sourceColumn}
                      </td>
                      <td className="px-3 py-2">
                        {m.targetField ? (
                          <span className="inline-flex items-center rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-ink">
                            {TARGET_FIELD_LABELS[m.targetField]}
                          </span>
                        ) : (
                          <span className="text-xs text-ink-mute">non mappé</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-ink-soft">
                        {m.confidence}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-mute">{m.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
