'use client';

/**
 * Console SIG — Soldes Intermédiaires de Gestion (sémantique `range`, avec
 * comparaison N-1). Branchée sur `GET /organizations/:org/reports/sig`.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { SigReport } from '@/types/reports';

import { defaultPeriod, shiftYears, summarizePeriod } from './presets';
import { ReportRunner } from './report-runner';
import { SigResult } from './sig-result';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { validityFromSig } from './validity';

const MODE = 'sig';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly fromDate: string;
  readonly toDate: string;
  readonly compareFromDate?: string;
  readonly compareToDate?: string;
}

const buildParams = (s: SubmittedParams): URLSearchParams => {
  const p = new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate });
  if (s.compareFromDate !== undefined && s.compareToDate !== undefined) {
    p.set('compareFromDate', s.compareFromDate);
    p.set('compareToDate', s.compareToDate);
  }
  return p;
};

export function SigConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('range'));
  const [compare, setCompare] = useState(true);
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Calcul des soldes…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<SigReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: SigReport }>(
        `/organizations/${orgId}/reports/sig?${buildParams(submitted).toString()}`,
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
        setProgress({ value, stage: 'Calcul des soldes…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
      record(scopeOrg, MODE, period, durationMs, { compare });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query.dataUpdatedAt]);

  const runGeneration = (): void => {
    if (period.kind !== 'range') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Calcul des soldes…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({
      fromDate: period.fromDate,
      toDate: period.toDate,
      ...(compare
        ? { compareFromDate: shiftYears(period.fromDate, -1), compareToDate: shiftYears(period.toDate, -1) }
        : {}),
    });
  };

  const download = (ext: 'xlsx' | 'pdf'): void => {
    if (submitted === null) return;
    void api.download(
      `/organizations/${orgId}/reports/sig.${ext}?${buildParams(submitted).toString()}`,
      `sig.${ext}`,
    );
  };

  const validity = query.data ? validityFromSig(query.data) : undefined;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Décomposition de la formation du résultat en soldes successifs (marge commerciale, valeur
        ajoutée, EBE, résultat d’exploitation…), conforme SYSCOHADA Tome 3.
      </p>

      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="SIG"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        scope={{ compare }}
        onApplyScope={(s) => setCompare(Boolean(s.compare))}
        scopeControls={
          <label className="flex h-9 cursor-pointer items-center gap-2 self-end whitespace-nowrap rounded-sm border border-line-strong bg-paper px-3 text-sm text-ink-soft transition-colors duration-fast hover:bg-sunk has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              className="h-3.5 w-3.5 accent-accent"
            />
            Comparer à N-1
          </label>
        }
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucun SIG généré pour le moment</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)}. Lancez la génération pour afficher la
              cascade des soldes.
            </p>
          </div>
        }
      >
        {query.data && <SigResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
