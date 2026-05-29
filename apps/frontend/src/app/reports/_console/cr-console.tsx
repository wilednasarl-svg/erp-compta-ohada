'use client';

/**
 * Console Compte de Résultat — état de plage (`range`). Branché sur
 * `GET /organizations/:org/reports/profit-loss`. Démontre un état SANS slot
 * périmètre : le guide se réduit alors à ① Période → ② Générer.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { ProfitLossReport } from '@/types/reports';

import { defaultPeriod, summarizePeriod } from './presets';
import { ProfitLossResult } from './profit-loss-result';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityFromProfitLoss } from './validity';

const MODE = 'profit-loss';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly fromDate: string;
  readonly toDate: string;
}

const buildParams = (s: SubmittedParams): URLSearchParams =>
  new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate });

export function CrConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('range'));
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Génération du compte de résultat…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<ProfitLossReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: ProfitLossReport }>(
        `/organizations/${orgId}/reports/profit-loss?${buildParams(submitted).toString()}`,
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
        setProgress({ value, stage: 'Génération du compte de résultat…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
    setProgress({ value: 0, stage: 'Génération du compte de résultat…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({ fromDate: period.fromDate, toDate: period.toDate });
  };

  const download = (ext: 'xlsx' | 'pdf'): void => {
    if (submitted === null) return;
    void api.download(
      `/organizations/${orgId}/reports/profit-loss.${ext}?${buildParams(submitted).toString()}`,
      `compte-resultat.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data ? validityFromProfitLoss(query.data) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Charges et produits de l’exercice, cascade doctrinale SYSCOHADA (Soldes Intermédiaires de
        Gestion). Le résultat net (produits − charges) est repris au bilan via les capitaux propres.
      </p>

      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Compte de résultat"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucun compte de résultat généré pour le moment</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)}. Lancez la génération pour afficher la
              cascade charges / produits.
            </p>
          </div>
        }
      >
        {query.data && <ProfitLossResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
