'use client';

/**
 * Console Ratios financiers — état à date (`as-at`), sans périmètre. Branchée
 * sur `GET /organizations/:org/reports/financial-ratios`.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { FinancialRatiosReport } from '@/types/reports';

import { defaultPeriod, summarizePeriod } from './presets';
import { RatiosResult } from './ratios-result';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityAsOf } from './validity';

const MODE = 'ratios';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
}

const buildParams = (s: SubmittedParams): URLSearchParams =>
  new URLSearchParams({ asAtDate: s.asAtDate, fiscalYearStartDate: s.fiscalYearStartDate });

export function RatiosConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('as-at'));
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Calcul des ratios…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<FinancialRatiosReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: FinancialRatiosReport }>(
        `/organizations/${orgId}/reports/financial-ratios?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const status: RunStatus = query.isError
    ? 'error'
    : query.isFetching
      ? 'running'
      : query.data !== undefined
        ? 'ready'
        : 'idle';

  useEffect(() => {
    if (status === 'running') {
      if (timer.current) clearInterval(timer.current);
      const begin = startedAtRef.current || Date.now();
      timer.current = setInterval(() => {
        const elapsed = Date.now() - begin;
        const value = Math.min(0.9, elapsed / PROGRESS_TARGET_MS);
        setProgress({ value, stage: 'Calcul des ratios…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
      }, 80);
    } else {
      if (timer.current) clearInterval(timer.current);
      if (status === 'ready') setProgress((p) => ({ ...p, value: 1 }));
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [status]);

  useEffect(() => {
    if (status === 'ready' && query.dataUpdatedAt && String(query.dataUpdatedAt) !== lastRecorded.current) {
      lastRecorded.current = String(query.dataUpdatedAt);
      const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
      record(scopeOrg, MODE, period, durationMs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query.dataUpdatedAt]);

  const runGeneration = (): void => {
    if (period.kind !== 'as-at') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Calcul des ratios…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({ asAtDate: period.asAtDate, fiscalYearStartDate: period.fiscalYearStartDate });
  };

  const download = (ext: 'xlsx' | 'pdf'): Promise<void> | undefined => {
    if (submitted === null) return undefined;
    return api.download(
      `/organizations/${orgId}/reports/financial-ratios.${ext}?${buildParams(submitted).toString()}`,
      `ratios.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data ? validityAsOf(query.data.asAtDate) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Indicateurs de structure, liquidité, solvabilité, rentabilité et activité, calculés à partir
        du bilan et du compte de résultat à la date d’arrêté.
      </p>

      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Ratios"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucun ratio calculé pour le moment</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)}. Lancez la génération pour afficher les
              ratios financiers.
            </p>
          </div>
        }
      >
        {query.data && <RatiosResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
