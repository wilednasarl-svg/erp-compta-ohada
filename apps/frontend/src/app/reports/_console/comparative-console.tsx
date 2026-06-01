'use client';

/**
 * Console Balance comparative — plage N confrontée à N-1 (dérivée par décalage
 * d'un an). Branchée sur `GET /organizations/:org/reports/comparative-balance`.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { ComparativeBalanceReport } from '@/types/reports';

import { ComparativeResult } from './comparative-result';
import { defaultPeriod, shiftYears, summarizePeriod } from './presets';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityFromComparativeBalance } from './validity';

const MODE = 'comparative-balance';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly fromDate: string;
  readonly toDate: string;
  readonly previousFromDate: string;
  readonly previousToDate: string;
  readonly accountClass: string;
}

const buildParams = (s: SubmittedParams): URLSearchParams => {
  const p = new URLSearchParams({
    fromDate: s.fromDate,
    toDate: s.toDate,
    previousFromDate: s.previousFromDate,
    previousToDate: s.previousToDate,
  });
  if (s.accountClass !== '') p.set('accountClass', s.accountClass);
  return p;
};

export function ComparativeConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('range'));
  const [accountClass, setAccountClass] = useState('');
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Comparaison des périodes…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<ComparativeBalanceReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: ComparativeBalanceReport }>(
        `/organizations/${orgId}/reports/comparative-balance?${buildParams(submitted).toString()}`,
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
        setProgress({ value, stage: 'Comparaison des périodes…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
      record(scopeOrg, MODE, period, durationMs, { accountClass });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query.dataUpdatedAt]);

  const runGeneration = (): void => {
    if (period.kind !== 'range') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Comparaison des périodes…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({
      fromDate: period.fromDate,
      toDate: period.toDate,
      previousFromDate: shiftYears(period.fromDate, -1),
      previousToDate: shiftYears(period.toDate, -1),
      accountClass,
    });
  };

  const download = (ext: 'xlsx' | 'pdf'): Promise<void> | undefined => {
    if (submitted === null) return undefined;
    return api.download(
      `/organizations/${orgId}/reports/comparative-balance.${ext}?${buildParams(submitted).toString()}`,
      `balance-comparative.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data ? validityFromComparativeBalance(query.data) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Confronte les mouvements de la période choisie à ceux de l’exercice précédent (N-1),
        compte par compte, avec la variation en valeur et en pourcentage.
      </p>

      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Balance comparative"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        exportFormats={['xlsx']}
        scope={{ accountClass }}
        onApplyScope={(s) => {
          if (typeof s.accountClass === 'string') setAccountClass(s.accountClass);
        }}
        scopeControls={
          <label className="space-y-1">
            <span className="text-2xs uppercase tracking-wider text-ink-soft">Classe</span>
            <select
              value={accountClass}
              onChange={(e) => setAccountClass(e.target.value)}
              className="h-9 w-32 rounded-sm border border-line-strong bg-paper px-2 text-sm text-ink focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none"
            >
              <option value="">Toutes</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((c) => (
                <option key={c} value={String(c)}>
                  Classe {c}
                </option>
              ))}
            </select>
          </label>
        }
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucune balance comparative générée</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)} (comparée à N-1). Lancez la génération.
            </p>
          </div>
        }
      >
        {query.data && <ComparativeResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
