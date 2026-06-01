'use client';

/**
 * Console Tendance de trésorerie — plage (`range`) ramenée au mois. Branchée sur
 * `GET /organizations/:org/reports/cash-trend` (params fromMonth/toMonth).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { CashTrendReport } from '@/types/reports';

import { CashTrendResult } from './cash-trend-result';
import { defaultPeriod, summarizePeriod } from './presets';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityAsOf } from './validity';

const MODE = 'cash-trend';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly fromMonth: string;
  readonly toMonth: string;
}

const buildParams = (s: SubmittedParams): URLSearchParams =>
  new URLSearchParams({ fromMonth: s.fromMonth, toMonth: s.toMonth });

export function CashTrendConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('range'));
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Calcul de la tendance…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<CashTrendReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: CashTrendReport }>(
        `/organizations/${orgId}/reports/cash-trend?${buildParams(submitted).toString()}`,
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
        setProgress({ value, stage: 'Calcul de la tendance…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
    setProgress({ value: 0, stage: 'Calcul de la tendance…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({ fromMonth: period.fromDate.slice(0, 7), toMonth: period.toDate.slice(0, 7) });
  };

  const download = (ext: 'xlsx' | 'pdf'): Promise<void> | undefined => {
    if (submitted === null) return undefined;
    return api.download(
      `/organizations/${orgId}/reports/cash-trend.${ext}?${buildParams(submitted).toString()}`,
      `tendance-tresorerie.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data && period.kind === 'range' ? validityAsOf(period.toDate) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Évolution mensuelle de la trésorerie nette sur la période choisie, avec variation d’un mois à
        l’autre et niveau relatif (min/max).
      </p>

      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Tendance de trésorerie"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucune tendance générée pour le moment</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)}. Lancez la génération pour afficher
              l’évolution mensuelle.
            </p>
          </div>
        }
      >
        {query.data && <CashTrendResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
