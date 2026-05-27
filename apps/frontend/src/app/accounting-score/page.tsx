'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';

/* ─── Types ──────────────────────────────────────────────────── */

type Grade = 'A' | 'B' | 'C' | 'D';
type CriterionKey =
  | 'anomalies'
  | 'missing_justification'
  | 'bank_reconciliation'
  | 'workflow_delays';

interface CriterionResult {
  readonly score: number;
  readonly weight: number;
  readonly description: string;
  readonly details: Record<string, unknown>;
}

interface ScoreView {
  readonly id: string;
  readonly exerciseId: string;
  readonly score: number;
  readonly grade: Grade;
  readonly breakdown: Record<CriterionKey, CriterionResult>;
  readonly calculatedAt: string;
  readonly calculatedBy: string;
}

/* ─── Constants ──────────────────────────────────────────────── */

const CRITERION_LABEL: Record<CriterionKey, string> = {
  anomalies: 'Anomalies IA',
  missing_justification: 'Justificatifs manquants',
  bank_reconciliation: 'Rapprochements bancaires',
  workflow_delays: 'Retards workflow',
};

const CRITERION_HELP: Record<CriterionKey, string> = {
  anomalies: 'Détection automatique d’incohérences sur écritures validées.',
  missing_justification: 'Pièces justificatives attendues mais non rattachées.',
  bank_reconciliation: 'Couverture du rapprochement sur comptes 521x/512x.',
  workflow_delays: 'Délai moyen draft → approved sur instances ouvertes.',
};

/* ─── Helpers ────────────────────────────────────────────────── */

function gradeMeta(grade: Grade): { label: string; tone: 'accent' | 'warn' | 'critical' } {
  if (grade === 'A') return { label: 'Excellent', tone: 'accent' };
  if (grade === 'B') return { label: 'Correct', tone: 'accent' };
  if (grade === 'C') return { label: 'À surveiller', tone: 'warn' };
  return { label: 'À améliorer', tone: 'critical' };
}

function scoreTone(value: number): 'accent' | 'warn' | 'critical' {
  if (value >= 80) return 'accent';
  if (value >= 60) return 'warn';
  return 'critical';
}

function toneChip(tone: 'accent' | 'warn' | 'critical'): string {
  if (tone === 'accent') return 'bg-accent-soft text-accent-ink';
  if (tone === 'warn') return 'bg-warn-soft text-warn-ink';
  return 'bg-critical-soft text-critical-ink';
}

function toneBar(tone: 'accent' | 'warn' | 'critical'): string {
  if (tone === 'accent') return 'bg-accent';
  if (tone === 'warn') return 'bg-warn';
  return 'bg-critical';
}

/* ─── ScoreGauge ─────────────────────────────────────────────── */

function ScoreGauge({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((score / max) * 100)));
  const tone = scoreTone(pct);
  const ringColor =
    tone === 'accent' ? 'text-accent' : tone === 'warn' ? 'text-warn' : 'text-critical';
  const meta = pct >= 80 ? 'Excellent' : pct >= 60 ? 'Correct' : 'À améliorer';

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 36 36" className="h-28 w-28 -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-line-strong"
          />
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            className={ringColor}
            stroke="currentColor"
            strokeDasharray={`${pct} 100`}
            style={{ transition: 'stroke-dasharray 900ms cubic-bezier(0.23, 1, 0.32, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
            {Math.round(score)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            / {max}
          </span>
        </div>
      </div>
      <div>
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-sm font-medium ${toneChip(tone)}`}
        >
          {meta}
        </span>
        <p className="mt-1.5 text-xs text-ink-mute">Score sur {max} points</p>
      </div>
    </div>
  );
}

/* ─── EmptyState ─────────────────────────────────────────────── */

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
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
      </div>
    </div>
  );
}

/* ─── Skeleton ───────────────────────────────────────────────── */

function ScoreSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="flex items-center gap-6 rounded-sm border border-line bg-paper p-6">
        <div className="h-28 w-28 rounded-full bg-sunk" />
        <div className="flex-1 space-y-3">
          <div className="h-3 w-24 rounded-xs bg-sunk" />
          <div className="h-5 w-48 rounded-xs bg-sunk" />
          <div className="h-3 w-32 rounded-xs bg-sunk" />
        </div>
      </div>
      <div className="divide-y divide-line rounded-sm border border-line bg-paper">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-4">
            <div className="h-3 w-40 rounded-xs bg-sunk" />
            <div className="h-3 flex-1 rounded-xs bg-sunk" />
            <div className="h-3 w-16 rounded-xs bg-sunk" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── CriterionRow ───────────────────────────────────────────── */

function CriterionRow({
  label,
  help,
  criterion,
}: {
  label: string;
  help: string;
  criterion: CriterionResult;
}) {
  const tone = scoreTone(criterion.score);
  const contribution = Math.round(criterion.score * criterion.weight);
  const good = criterion.score >= 70;

  return (
    <div className="grid grid-cols-1 gap-4 px-5 py-5 transition-colors duration-fast hover:bg-sunk/40 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-ink">{label}</p>
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            poids {Math.round(criterion.weight * 100)}%
          </span>
        </div>
        <p className="mt-1 text-xs text-ink-mute">{help}</p>
        <p className="mt-2 text-xs text-ink-soft">{criterion.description}</p>

        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunk">
            <div
              className={`h-full rounded-full transition-all duration-700 ${toneBar(tone)}`}
              style={{ width: `${Math.max(2, criterion.score)}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-ink-soft">
            {Math.round(criterion.score)}/100
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 md:flex-col md:items-end">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${toneChip(tone)}`}
        >
          {good ? (
            <TrendingUp className="h-3 w-3" strokeWidth={2} />
          ) : (
            <TrendingDown className="h-3 w-3" strokeWidth={2} />
          )}
          {contribution} pts
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">
          contribution
        </span>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function AccountingScorePage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');

  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const data = await api.get<{ periods: ReadonlyArray<AccountingPeriodView> }>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return data.periods;
    },
    enabled: orgId !== '',
  });

  const exercises = useMemo(
    () =>
      (periodsQuery.data ?? [])
        .filter((p) => p.parentId === null)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [periodsQuery.data],
  );

  useEffect(() => {
    const first = exercises[0];
    if (selectedExerciseId === '' && first !== undefined) {
      setSelectedExerciseId(first.id);
    }
  }, [selectedExerciseId, exercises]);

  const scoreQuery = useQuery<ScoreView | null, ApiError>({
    queryKey: ['accounting-score', orgId, selectedExerciseId],
    queryFn: async () => {
      try {
        const data = await api.get<{ score: ScoreView | null }>(
          `/organizations/${orgId}/accounting-score?exerciseId=${selectedExerciseId}`,
        );
        return data.score;
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: orgId !== '' && selectedExerciseId !== '',
  });

  const recalcMut = useApiMutation(async () => {
    return api.post(`/organizations/${orgId}/accounting-score/recalculate`, {
      exerciseId: selectedExerciseId,
    });
  });

  async function handleRecalculate(): Promise<void> {
    await recalcMut.mutateAsync(undefined);
    void qc.invalidateQueries({ queryKey: ['accounting-score'] });
  }

  const score = scoreQuery.data;
  const grade = score ? gradeMeta(score.grade) : null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[960px] animate-page-in space-y-10">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Analyse &amp; IA · Score</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Score de santé comptable
          </h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Indice qualité OHADA calculé en temps réel. Mesure la rigueur de la saisie,
            l&apos;exhaustivité des états, la conformité aux normes SYSCOHADA.
          </p>
        </header>

        {/* ─── Controls ───────────────────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
          <div className="min-w-[260px] space-y-1.5">
            <Label htmlFor="exercise">Exercice</Label>
            <select
              id="exercise"
              className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
              value={selectedExerciseId}
              onChange={(e) => setSelectedExerciseId(e.target.value)}
              disabled={periodsQuery.isLoading}
            >
              {exercises.length === 0 && <option value="">— aucun exercice —</option>}
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={() => void handleRecalculate()}
            disabled={recalcMut.isPending || selectedExerciseId === ''}
            className="press"
          >
            {recalcMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Recalculer
          </Button>
        </div>

        {/* ─── Body ───────────────────────────────────────── */}
        {scoreQuery.isLoading ? (
          <ScoreSkeleton />
        ) : !score || !grade ? (
          <div className="rounded-sm border border-dashed border-line bg-paper">
            <EmptyState
              icon={Award}
              title="Score non calculé"
              description="Validez vos premières écritures pour obtenir votre indice qualité."
            />
          </div>
        ) : (
          <>
            {/* Score banner */}
            <section
              className={`rounded-sm border border-line bg-paper p-6 ${grade.tone === 'critical' ? 'border-critical/40' : grade.tone === 'warn' ? 'border-warn/40' : 'border-accent/40'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-6">
                <div className="flex items-center gap-8">
                  <ScoreGauge score={score.score} />
                  <div className="hidden h-16 w-px bg-line md:block" aria-hidden />
                  <div>
                    <p className="eyebrow mb-1">Note OHADA</p>
                    <p className="font-display text-6xl font-medium leading-none text-ink">
                      {score.grade}
                    </p>
                    <p className="mt-2 text-xs text-ink-mute">{grade.label}</p>
                  </div>
                </div>
                <div className="text-right text-xs text-ink-mute">
                  <p className="eyebrow mb-1">Dernier calcul</p>
                  <p className="font-mono tabular-nums text-ink-soft">
                    {new Date(score.calculatedAt).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="mt-0.5">par {score.calculatedBy}</p>
                </div>
              </div>
            </section>

            {/* Criteria */}
            <section>
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="font-display text-xl font-medium text-ink">
                  Décomposition par critère
                </h2>
                <span className="font-mono text-xs uppercase tracking-wider text-ink-mute">
                  4 critères pondérés
                </span>
              </div>
              <div className="divide-y divide-line rounded-sm border border-line bg-paper">
                {(Object.keys(score.breakdown) as CriterionKey[]).map((key) => (
                  <CriterionRow
                    key={key}
                    label={CRITERION_LABEL[key]}
                    help={CRITERION_HELP[key]}
                    criterion={score.breakdown[key]}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
