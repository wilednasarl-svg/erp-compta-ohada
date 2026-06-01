'use client';

/**
 * Console Balance âgée — état à date (`as-at`). Branchée sur
 * `GET /organizations/:org/reports/aging-balance`. Périmètre = côté analysé
 * (créances clients ou dettes fournisseurs).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { AgingBalanceReport, AgingSide } from '@/types/reports';

import { AgingResult } from './aging-result';
import { defaultPeriod, summarizePeriod } from './presets';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityAsOf } from './validity';

const MODE = 'aging-balance';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly side: AgingSide;
  readonly asAtDate: string;
}

const buildParams = (s: SubmittedParams): URLSearchParams =>
  new URLSearchParams({ side: s.side, asAtDate: s.asAtDate });

export function AgingConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('as-at'));
  const [side, setSide] = useState<AgingSide>('CLIENT');
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Ventilation par ancienneté…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<AgingBalanceReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: AgingBalanceReport }>(
        `/organizations/${orgId}/reports/aging-balance?${buildParams(submitted).toString()}`,
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
        setProgress({ value, stage: 'Ventilation par ancienneté…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
      record(scopeOrg, MODE, period, durationMs, { side });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query.dataUpdatedAt]);

  const runGeneration = (): void => {
    if (period.kind !== 'as-at') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Ventilation par ancienneté…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({ side, asAtDate: period.asAtDate });
  };

  const download = (ext: 'xlsx' | 'pdf'): Promise<void> | undefined => {
    if (submitted === null) return undefined;
    return api.download(
      `/organizations/${orgId}/reports/aging-balance.${ext}?${buildParams(submitted).toString()}`,
      `balance-agee.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data ? validityAsOf(query.data.asAtDate) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Ventilation des soldes clients ou fournisseurs par tranche d’ancienneté à la date d’arrêté,
        pour piloter le recouvrement et les règlements.
      </p>

      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Balance âgée"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        scope={{ side }}
        onApplyScope={(s) => {
          if (s.side === 'CLIENT' || s.side === 'FOURNISSEUR') setSide(s.side);
        }}
        scopeControls={
          <label className="space-y-1">
            <span className="text-2xs uppercase tracking-wider text-ink-soft">Côté</span>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as AgingSide)}
              className="h-9 w-40 rounded-sm border border-line-strong bg-paper px-2 text-sm text-ink focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none"
            >
              <option value="CLIENT">Créances clients</option>
              <option value="FOURNISSEUR">Dettes fournisseurs</option>
            </select>
          </label>
        }
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucune balance âgée générée pour le moment</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)}. Choisissez le côté puis lancez la
              génération.
            </p>
          </div>
        }
      >
        {query.data && <AgingResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
