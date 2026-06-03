'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import type { PreviewResult } from '@/types/imports';
import type { CoverageResponse, PeriodCoverageGaps } from '@/types/period-coverage';

/**
 * Porte de couverture des périodes à l'import (import-first).
 *
 * Une écriture ne peut être committée que si une période ouverte contient sa
 * date. On déduit la plage d'ANNÉES des écritures de l'aperçu — seule l'année
 * compte pour l'exercice, et c'est la partie non ambiguë de tout format de
 * date — puis on interroge la couverture. S'il manque un exercice, on propose
 * de le créer (1 clic) avant le commit. La création reste un geste explicite.
 */
export function PeriodCoverageGate({
  orgId,
  preview,
}: {
  orgId: string;
  preview: PreviewResult;
}): React.ReactElement | null {
  const queryClient = useQueryClient();

  const range = useMemo(() => yearRangeFromPreview(preview), [preview]);

  const coverageQuery = useQuery<PeriodCoverageGaps, ApiError>({
    queryKey: ['period-coverage', orgId, range?.from, range?.to],
    queryFn: async () => {
      const params = new URLSearchParams({ fromDate: range!.from, toDate: range!.to });
      const data = await api.get<CoverageResponse>(
        `/organizations/${orgId}/accounting-periods/coverage?${params.toString()}`,
      );
      return data.coverage;
    },
    enabled: orgId !== '' && range !== null,
  });

  const ensureMut = useApiMutation(async () => {
    return api.post(`/organizations/${orgId}/accounting-periods/ensure-coverage`, {
      fromDate: range!.from,
      toDate: range!.to,
    });
  });

  async function handleCreate(): Promise<void> {
    await ensureMut.mutateAsync(undefined);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['period-coverage'] }),
      queryClient.invalidateQueries({ queryKey: ['accounting-periods'] }),
    ]);
  }

  if (range === null) return null;

  const coverage = coverageQuery.data;
  if (coverageQuery.isLoading || !coverage) return null;

  // Tout est couvert : confirmation discrète, pas de friction.
  if (!coverage.hasGaps) {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-accent/30 bg-accent-soft/40 px-3 py-2 text-xs text-ink-soft">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-ink" strokeWidth={2} />
        Périodes prêtes pour {coverage.fromDate.slice(0, 4)}
        {coverage.toDate.slice(0, 4) !== coverage.fromDate.slice(0, 4)
          ? `–${coverage.toDate.slice(0, 4)}`
          : ''}{' '}
        — l&apos;import peut être committé.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-sm border border-warn/40 bg-warn-soft/40 p-4">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" strokeWidth={1.5} />
        <div className="min-w-0 text-sm text-ink">
          <p className="font-medium">Période(s) manquante(s) pour cet import</p>
          <p className="mt-1 text-xs text-ink-soft">
            Les écritures couvrent{' '}
            <span className="font-mono tabular-nums">
              {coverage.fromDate.slice(0, 4)}
              {coverage.toDate.slice(0, 4) !== coverage.fromDate.slice(0, 4)
                ? `–${coverage.toDate.slice(0, 4)}`
                : ''}
            </span>
            . Sans exercice ouvert couvrant ces dates, le commit échouera.
          </p>
        </div>
      </div>

      {coverage.missingYears.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pl-6">
          <p className="text-xs text-ink-soft">
            Exercice(s) à créer :{' '}
            <span className="font-medium text-ink">{coverage.missingYears.join(', ')}</span> (avec
            leurs 12 périodes mensuelles).
          </p>
          <Button
            type="button"
            size="sm"
            className="press"
            disabled={ensureMut.isPending}
            onClick={() => void handleCreate()}
          >
            {ensureMut.isPending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <CalendarPlus className="mr-2 h-3.5 w-3.5" />
            )}
            Créer {coverage.missingYears.length > 1 ? 'les exercices' : "l'exercice"}
          </Button>
          {ensureMut.error && (
            <span className="text-xs text-critical-ink">
              Échec : {ensureMut.error.message}
            </span>
          )}
        </div>
      )}

      {coverage.closedConflicts.length > 0 && (
        <p className="pl-6 text-xs text-ink-soft">
          <span className="font-medium text-warn-ink">
            {coverage.closedConflicts.length} période(s) fermée(s)
          </span>{' '}
          sur la plage ({coverage.closedConflicts.map((c) => c.label).join(', ')}). Rouvrez-les
          depuis <span className="font-medium">Périodes</span> avant de committer ces dates.
        </p>
      )}
    </div>
  );
}

/**
 * Déduit la plage d'années des écritures de l'aperçu. On cherche un groupe de
 * 4 chiffres plausible (1990–2100) dans la date mappée de chaque ligne — robuste
 * aux formats jj/mm/aaaa, aaaa-mm-jj, etc. `null` si aucune année exploitable.
 */
function yearRangeFromPreview(preview: PreviewResult): { from: string; to: string } | null {
  const years: number[] = [];
  for (const entry of preview.entries) {
    const raw = entry.mappedValues.date;
    if (raw == null) continue;
    const match = String(raw).match(/(?:19|20)\d{2}/);
    if (match === null) continue;
    const year = Number(match[0]);
    if (year >= 1990 && year <= 2100) years.push(year);
  }
  if (years.length === 0) return null;
  return { from: `${Math.min(...years)}-01-01`, to: `${Math.max(...years)}-12-31` };
}
