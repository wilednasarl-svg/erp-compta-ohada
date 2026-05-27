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

/* ─── Helpers ────────────────────────────────────────────────── */

function gradeTokens(grade: Grade): { bg: string; text: string; border: string } {
  if (grade === 'A') return { bg: 'bg-accent-soft', text: 'text-accent-ink', border: 'border-accent' };
  if (grade === 'B') return { bg: 'bg-accent-soft/60', text: 'text-accent-ink', border: 'border-accent/50' };
  if (grade === 'C') return { bg: 'bg-warn-soft', text: 'text-warn-ink', border: 'border-warn' };
  return { bg: 'bg-critical-soft', text: 'text-critical-ink', border: 'border-critical' };
}

function scoreColor(value: number): string {
  if (value >= 70) return 'text-accent-ink';
  if (value >= 50) return 'text-warn-ink';
  return 'text-critical-ink';
}

function scoreBarColor(value: number): string {
  if (value >= 70) return 'bg-accent';
  if (value >= 50) return 'bg-warn';
  return 'bg-critical';
}

/* ─── ScoreRing ──────────────────────────────────────────────── */

function ScoreRing({ value, size = 72 }: { value: number; size?: number }) {
  const r = size / 2 - 5;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);
  const strokeColor =
    value >= 70
      ? 'oklch(var(--accent))'
      : value >= 50
        ? 'oklch(var(--warn))'
        : 'oklch(var(--critical))';

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        fill="none"
        className="absolute inset-0"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="oklch(var(--line-strong))"
          strokeWidth="4"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={strokeColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        />
      </svg>
      <span className={`font-mono text-sm font-semibold tabular-nums ${scoreColor(value)}`}>
        {Math.round(value)}
      </span>
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
  const g = score ? gradeTokens(score.grade) : null;

  return (
    <AppShell>
      <div className="mx-auto max-w-[900px] animate-page-in space-y-10">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Qualité comptable</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Score de santé
          </h1>
          <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-ink-soft">
            Indicateur 0-100 agrégé sur 4 critères pondérés : anomalies IA, justificatifs,
            rapprochements bancaires, retards workflow. Heuristique SYSCOHADA.
          </p>
        </header>

        {/* ─── Controls ───────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-4 border-b border-line pb-8">
          <div className="min-w-[240px] space-y-2">
            <Label htmlFor="exercise">Exercice</Label>
            <select
              id="exercise"
              className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
              value={selectedExerciseId}
              onChange={(e) => setSelectedExerciseId(e.target.value)}
              disabled={periodsQuery.isLoading}
            >
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

        {/* ─── Score body ─────────────────────────────────── */}
        {scoreQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-ink-mute" />
          </div>
        ) : !score ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <Award className="h-12 w-12 text-ink-mute opacity-20" strokeWidth={1} />
            <p className="text-sm text-ink-mute">
              Aucun score pour cet exercice. Cliquez Recalculer.
            </p>
          </div>
        ) : (
          <>
            {/* Global score banner */}
            <div className={`rounded-sm border-2 p-8 ${g!.bg} ${g!.border}`}>
              <div className="flex flex-wrap items-center justify-between gap-8">
                <div className="flex items-center gap-8">
                  {/* Grade letter */}
                  <div className="text-center">
                    <p className="eyebrow mb-1">Note</p>
                    <p className={`font-display text-7xl font-medium leading-none ${g!.text}`}>
                      {score.grade}
                    </p>
                  </div>

                  <div className="h-16 w-px bg-line" aria-hidden />

                  {/* Numeric score */}
                  <div>
                    <p className="eyebrow mb-1">Score</p>
                    <p
                      className={`font-display text-5xl font-medium tabular-nums tracking-tight ${g!.text}`}
                    >
                      {Math.round(score.score)}
                      <span className="ml-1 font-display text-2xl font-medium text-ink-mute">
                        /100
                      </span>
                    </p>
                  </div>
                </div>

                <div className="text-right text-xs text-ink-mute">
                  <p>
                    Calculé le{' '}
                    {new Date(score.calculatedAt).toLocaleString('fr-FR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                  <p className="mt-0.5">{score.calculatedBy}</p>
                </div>
              </div>
            </div>

            {/* Criteria breakdown */}
            <div className="grid gap-6 md:grid-cols-2">
              {(Object.keys(score.breakdown) as CriterionKey[]).map((key) => {
                const c = score.breakdown[key];
                const good = c.score >= 70;
                return (
                  <div
                    key={key}
                    className="space-y-4 rounded-sm border border-line bg-paper p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="eyebrow mb-1">
                          Poids {Math.round(c.weight * 100)}%
                        </p>
                        <p className="text-base font-medium text-ink">
                          {CRITERION_LABEL[key]}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <ScoreRing value={c.score} size={52} />
                        {good ? (
                          <TrendingUp
                            className="h-4 w-4 text-accent-ink"
                            strokeWidth={1.5}
                          />
                        ) : (
                          <TrendingDown
                            className="h-4 w-4 text-critical-ink"
                            strokeWidth={1.5}
                          />
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 overflow-hidden rounded-full bg-sunk">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${scoreBarColor(c.score)}`}
                        style={{ width: `${c.score}%` }}
                      />
                    </div>

                    <div className="flex items-baseline justify-between">
                      <p className="text-xs text-ink-mute">{c.description}</p>
                      <span className="shrink-0 rounded-xs bg-sunk px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                        contribution {Math.round(c.score * c.weight)} pts
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
