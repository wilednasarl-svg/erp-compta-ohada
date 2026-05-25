'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Loader2, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

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
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';

type Grade = 'A' | 'B' | 'C' | 'D';
type CriterionKey = 'anomalies' | 'missing_justification' | 'bank_reconciliation' | 'workflow_delays';

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

const CRITERION_LABEL: Record<CriterionKey, string> = {
  anomalies: 'Anomalies IA',
  missing_justification: 'Justificatifs manquants',
  bank_reconciliation: 'Rapprochements bancaires',
  workflow_delays: 'Retards workflow',
};

const GRADE_COLOR: Record<Grade, string> = {
  A: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  B: 'bg-lime-100 text-lime-900 border-lime-300',
  C: 'bg-amber-100 text-amber-900 border-amber-300',
  D: 'bg-rose-100 text-rose-900 border-rose-300',
};

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

  // Default to the latest exercise once loaded.
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

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Score de santé comptable</h1>
          <p className="text-sm text-muted-foreground">
            Indicateur 0-100 agrégé sur 4 critères pondérés (anomalies IA, justificatifs,
            rapprochements bancaires, retards workflow). Heuristique pure SYSCOHADA.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1.5 min-w-[240px]">
                <Label htmlFor="exercise">Exercice</Label>
                <select
                  id="exercise"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={selectedExerciseId}
                  onChange={(e) => setSelectedExerciseId(e.target.value)}
                  disabled={periodsQuery.isLoading}
                >
                  {exercises.map((ex) => (
                    <option key={ex.id} value={ex.id}>{ex.label}</option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => void handleRecalculate()}
                disabled={recalcMut.isPending || selectedExerciseId === ''}
              >
                {recalcMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Recalculer
              </Button>
            </div>
          </CardContent>
        </Card>

        {scoreQuery.isLoading ? (
          <div className="text-center py-12"><Loader2 className="inline h-6 w-6 animate-spin" /></div>
        ) : scoreQuery.data === null ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <Award className="mx-auto h-10 w-10 opacity-30 mb-2" />
              <div className="text-sm">Aucun score calculé pour cet exercice. Cliquez "Recalculer".</div>
            </CardContent>
          </Card>
        ) : scoreQuery.data && (
          <>
            <Card className={`border-2 ${GRADE_COLOR[scoreQuery.data.grade]}`}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Score global</div>
                    <div className="text-5xl font-bold tabular-nums">{Math.round(scoreQuery.data.score)}<span className="text-2xl text-muted-foreground">/100</span></div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground mb-1">Note</div>
                    <div className="text-6xl font-bold">{scoreQuery.data.grade}</div>
                  </div>
                  <div className="text-xs text-muted-foreground text-right">
                    Calculé le {new Date(scoreQuery.data.calculatedAt).toLocaleString('fr-FR')}<br />
                    Source : {scoreQuery.data.calculatedBy}
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-2">
              {(Object.keys(scoreQuery.data.breakdown) as CriterionKey[]).map((key) => {
                const c = scoreQuery.data!.breakdown[key];
                const isGood = c.score >= 70;
                return (
                  <Card key={key}>
                    <CardHeader>
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">{CRITERION_LABEL[key]}</CardTitle>
                        {isGood
                          ? <TrendingUp className="h-5 w-5 text-emerald-600" />
                          : <TrendingDown className="h-5 w-5 text-rose-600" />}
                      </div>
                      <CardDescription>
                        Poids dans le score : {Math.round(c.weight * 100)}%
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-baseline justify-between">
                          <div className="text-3xl font-bold tabular-nums">{Math.round(c.score)}</div>
                          <Badge variant="outline">contribution : {Math.round(c.score * c.weight)} pts</Badge>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={isGood ? 'bg-emerald-500 h-full' : 'bg-rose-500 h-full'}
                            style={{ width: `${c.score}%` }}
                          />
                        </div>
                        <p className="text-sm text-muted-foreground">{c.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
