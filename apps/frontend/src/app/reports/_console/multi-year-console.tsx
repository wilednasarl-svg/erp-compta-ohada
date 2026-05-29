'use client';

/**
 * Console Balance pluriannuelle — l'utilisateur choisit l'exercice N (plage) ;
 * les exercices N-1 et N-2 sont dérivés par décalage d'un an. Branchée sur
 * `GET /organizations/:org/reports/multi-year-balance` (params period1..period3).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { MultiYearBalanceReport } from '@/types/reports';

import { MultiYearResult } from './multi-year-result';
import { defaultPeriod, shiftYears, summarizePeriod } from './presets';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityAsOf } from './validity';

const MODE = 'multi-year-balance';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly fromDate: string;
  readonly toDate: string;
}

/** Construit 3 exercices : N-2, N-1, N (N = plage choisie). */
const buildParams = (s: SubmittedParams): URLSearchParams => {
  const periods = [
    { fromDate: shiftYears(s.fromDate, -2), toDate: shiftYears(s.toDate, -2) },
    { fromDate: shiftYears(s.fromDate, -1), toDate: shiftYears(s.toDate, -1) },
    { fromDate: s.fromDate, toDate: s.toDate },
  ];
  const p = new URLSearchParams();
  periods.forEach((per, i) => {
    p.set(`period${i + 1}FromDate`, per.fromDate);
    p.set(`period${i + 1}ToDate`, per.toDate);
  });
  return p;
};

export function MultiYearConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('range'));
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Agrégation pluriannuelle…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<MultiYearBalanceReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: MultiYearBalanceReport }>(
        `/organizations/${orgId}/reports/multi-year-balance?${buildParams(submitted).toString()}`,
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
        setProgress({ value, stage: 'Agrégation pluriannuelle…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
    if (period.kind !== 'range') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Agrégation pluriannuelle…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({ fromDate: period.fromDate, toDate: period.toDate });
  };

  const download = (ext: 'xlsx' | 'pdf'): void => {
    if (submitted === null) return;
    void api.download(
      `/organizations/${orgId}/reports/multi-year-balance.${ext}?${buildParams(submitted).toString()}`,
      `balance-pluriannuelle.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data && period.kind === 'range' ? validityAsOf(period.toDate) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Évolution du solde de chaque compte sur trois exercices consécutifs (N, N-1, N-2). Choisissez
        l’exercice le plus récent ; les deux précédents sont dérivés automatiquement.
      </p>

      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Balance pluriannuelle"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucune balance pluriannuelle générée</p>
            <p className="text-sm text-ink-soft">
              Exercice N : {summarizePeriod(period)}. Lancez la génération pour comparer N, N-1 et N-2.
            </p>
          </div>
        }
      >
        {query.data && <MultiYearResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
