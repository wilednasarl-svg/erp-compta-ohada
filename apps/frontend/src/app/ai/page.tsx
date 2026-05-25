'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Brain, Lightbulb, Loader2, Play, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
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
  readonly meta: { readonly total: number; readonly page: number; readonly pageSize: number };
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

/**
 * `/ai` — Module 11 wave 1 : moteur d'anomalies + suggestions de compte.
 *
 * UX :
 *   - Section haute = sélection d'une période + bouton "Scanner" qui
 *     déclenche le full-recalc côté backend, puis affichage des stats
 *     (lignes scannées, anomalies détectées, durée).
 *   - Section centrale = table paginée des anomalies, triée par score
 *     décroissant, avec filtre par type. Chaque ligne expose ses
 *     `reasons[]` en clair.
 *   - Section basse = bac à sable pour tester une suggestion de
 *     compte : on saisit un libellé, l'API renvoie le code suggéré
 *     avec un éventuel candidat alternatif.
 *
 * Tout reste heuristique côté backend — aucun LLM en wave 1. Quand
 * la wave 2 branchera un modèle, cette UI ne change pas, juste la
 * `confidence` montera.
 */
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
      const data = await api.get<PeriodsResponse>(`/organizations/${orgId}/accounting-periods`);
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
      return api.get<AnomaliesResponse>(`/organizations/${orgId}/ai/anomalies?${params}`);
    },
    enabled: orgId !== '',
  });

  const scanMutation = useApiMutation<{ stats: ScanStats }, { periodId: string }>(
    ({ periodId }) =>
      api.post<{ stats: ScanStats }>(`/organizations/${orgId}/ai/anomalies/scan`, { periodId }),
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

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <header className="flex items-center gap-3">
          <Brain className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">IA — Anomalies &amp; suggestions</h1>
            <p className="text-sm text-muted-foreground">
              Module 11 wave 1 — heuristiques déterministes (sans LLM).
            </p>
          </div>
        </header>

        <ScanCard
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

        <AnomaliesCard
          anomalies={anomaliesQuery.data?.anomalies ?? []}
          total={anomaliesQuery.data?.meta.total ?? 0}
          loading={anomaliesQuery.isLoading}
          error={anomaliesQuery.error}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          minScore={minScore}
          onMinScoreChange={setMinScore}
        />

        <SuggestionCard orgId={orgId} />
      </div>
    </AppShell>
  );
}

// ─── Scan card ────────────────────────────────────────────────────────

interface ScanCardProps {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
  readonly selectedPeriodId: string;
  readonly onPeriodChange: (id: string) => void;
  readonly onScan: () => void;
  readonly loading: boolean;
  readonly stats: ScanStats | null;
  readonly error: ApiError | null;
}

function ScanCard({
  periods,
  selectedPeriodId,
  onPeriodChange,
  onScan,
  loading,
  stats,
  error,
}: ScanCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-4 w-4" /> Scanner une période
        </CardTitle>
        <CardDescription>
          Recalcul complet des anomalies sur la période choisie. Les anciennes anomalies de la
          période sont effacées avant ré-insertion.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end">
          <div className="flex-1">
            <Label htmlFor="period-select">Période fiscale</Label>
            <select
              id="period-select"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedPeriodId}
              onChange={(e) => onPeriodChange(e.target.value)}
            >
              <option value="">— Toutes les anomalies déjà détectées —</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.startDate} → {p.endDate}) {p.status === 'closed' ? '— clôturée' : ''}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={onScan}
            disabled={loading || selectedPeriodId === ''}
            className="md:w-44"
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
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm dark:border-green-900 dark:bg-green-950/40">
            <div className="font-medium">Scan terminé en {stats.durationMs} ms.</div>
            <div className="mt-1 text-muted-foreground">
              {stats.entriesScanned} écriture{stats.entriesScanned > 1 ? 's' : ''} ·{' '}
              {stats.linesScanned} ligne{stats.linesScanned > 1 ? 's' : ''} · {stats.anomaliesDetected}{' '}
              anomalie{stats.anomaliesDetected > 1 ? 's' : ''} détectée
              {stats.anomaliesDetected > 1 ? 's' : ''}.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Anomalies card ───────────────────────────────────────────────────

interface AnomaliesCardProps {
  readonly anomalies: ReadonlyArray<AiAnomaly>;
  readonly total: number;
  readonly loading: boolean;
  readonly error: ApiError | null;
  readonly typeFilter: AnomalyType | '';
  readonly onTypeFilterChange: (t: AnomalyType | '') => void;
  readonly minScore: number;
  readonly onMinScoreChange: (s: number) => void;
}

function AnomaliesCard({
  anomalies,
  total,
  loading,
  error,
  typeFilter,
  onTypeFilterChange,
  minScore,
  onMinScoreChange,
}: AnomaliesCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Anomalies détectées ({total})
        </CardTitle>
        <CardDescription>
          Triées par risque décroissant. Chaque ligne expose ses raisons en clair.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="type-filter">Type</Label>
            <select
              id="type-filter"
              className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={typeFilter}
              onChange={(e) => onTypeFilterChange((e.target.value as AnomalyType) || '')}
            >
              <option value="">Tous</option>
              {(Object.keys(ANOMALY_TYPE_LABELS) as AnomalyType[]).map((t) => (
                <option key={t} value={t}>
                  {ANOMALY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="min-score">Score minimum</Label>
            <Input
              id="min-score"
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => onMinScoreChange(Number(e.target.value) || 0)}
              className="mt-1 w-24"
            />
          </div>
        </div>

        {error && <FormError error={{ code: error.code, message: error.message }} />}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : anomalies.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Aucune anomalie détectée pour les filtres actuels.
          </div>
        ) : (
          <div className="space-y-2">
            {anomalies.map((a) => (
              <AnomalyRow key={a.id} anomaly={a} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AnomalyRow({ anomaly }: { anomaly: AiAnomaly }) {
  const color =
    anomaly.riskScore >= 70
      ? 'destructive'
      : anomaly.riskScore >= 40
        ? 'warning'
        : 'secondary';
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={color as 'destructive' | 'secondary'} className="uppercase tracking-wide">
            Score {anomaly.riskScore}
          </Badge>
          <span className="text-sm font-medium">{ANOMALY_TYPE_LABELS[anomaly.anomalyType]}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {new Date(anomaly.detectedAt).toLocaleString('fr-FR')}
        </span>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        {anomaly.reasons.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

// ─── Suggestion sandbox ───────────────────────────────────────────────

function SuggestionCard({ orgId }: { orgId: string }) {
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-yellow-500" /> Suggestion de compte
        </CardTitle>
        <CardDescription>
          Bac à sable : saisir un libellé d&apos;écriture pour voir le compte heuristique proposé.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label htmlFor="suggest-desc">Libellé</Label>
            <Input
              id="suggest-desc"
              placeholder="Ex: Loyer bureau juin 2026"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="suggest-partner">Tiers (optionnel)</Label>
            <Input
              id="suggest-partner"
              placeholder="SODECI"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="suggest-side">Sens</Label>
            <select
              id="suggest-side"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
            <div className="space-y-2 rounded-md border bg-card p-3">
              <div className="flex items-center gap-2">
                <Badge>Compte {suggestionMutation.data.suggestion.suggestedAccountCode}</Badge>
                <span className="text-sm font-medium">
                  Confiance : {suggestionMutation.data.suggestion.confidence} / 100
                </span>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {suggestionMutation.data.suggestion.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {suggestionMutation.data.suggestion.alternative && (
                <div className="border-t pt-2 text-sm text-muted-foreground">
                  <span className="font-medium">Alternative :</span>{' '}
                  Compte {suggestionMutation.data.suggestion.alternative.accountCode} (confiance{' '}
                  {suggestionMutation.data.suggestion.alternative.confidence}) —{' '}
                  {suggestionMutation.data.suggestion.alternative.reasons.join(' ')}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Aucune suggestion : le libellé ne matche aucun pattern ni historique suffisant.
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
