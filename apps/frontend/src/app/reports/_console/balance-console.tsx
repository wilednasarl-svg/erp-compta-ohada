'use client';

/**
 * Console Balance générale — état de plage (sémantique `range` Du/Au). Première
 * démonstration du mode plage du framework. Branché sur l'endpoint réel
 * `GET /organizations/:org/reports/trial-balance`. Validité dérivée du rapport
 * (Σ débit clôture = Σ crédit clôture).
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { TrialBalanceReport } from '@/types/reports';

import { defaultPeriod, summarizePeriod } from './presets';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import { TrialBalanceResult } from './trial-balance-result';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityFromTrialBalance } from './validity';

const MODE = 'trial-balance';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly fromDate: string;
  readonly toDate: string;
  readonly accountClass: string;
  readonly hideEmpty: boolean;
}

const buildParams = (s: SubmittedParams): URLSearchParams => {
  const p = new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate });
  if (s.accountClass !== '') p.set('accountClass', s.accountClass);
  if (s.hideEmpty) p.set('hideEmpty', 'true');
  return p;
};

export function BalanceConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('range'));
  const [accountClass, setAccountClass] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Génération de la balance…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<TrialBalanceReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: TrialBalanceReport }>(
        `/organizations/${orgId}/reports/trial-balance?${buildParams(submitted).toString()}`,
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
        setProgress({ value, stage: 'Génération de la balance…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
      record(scopeOrg, MODE, period, durationMs, { accountClass, hideEmpty });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query.dataUpdatedAt]);

  const runGeneration = (): void => {
    if (period.kind !== 'range') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Génération de la balance…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({ fromDate: period.fromDate, toDate: period.toDate, accountClass, hideEmpty });
  };

  const download = (ext: 'xlsx' | 'pdf'): Promise<void> | undefined => {
    if (submitted === null) return undefined;
    return api.download(
      `/organizations/${orgId}/reports/trial-balance.${ext}?${buildParams(submitted).toString()}`,
      `balance.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data ? validityFromTrialBalance(query.data) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Solde de chaque compte sur la période choisie : ouverture, mouvements, clôture. Seules les
        écritures committées au journal sont projetées. L’équilibre Σ débit = Σ crédit (clôture) est
        contrôlé sur le rapport généré.
      </p>

      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Balance générale"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        scope={{ accountClass, hideEmpty }}
        onApplyScope={(s) => {
          if (typeof s.accountClass === 'string') setAccountClass(s.accountClass);
          setHideEmpty(Boolean(s.hideEmpty));
        }}
        scopeControls={
          <>
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
            <label className="flex h-9 cursor-pointer items-center gap-2 self-end whitespace-nowrap rounded-sm border border-line-strong bg-paper px-3 text-sm text-ink-soft transition-colors duration-fast hover:bg-sunk has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              Masquer comptes soldés
            </label>
          </>
        }
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucune balance générée pour le moment</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)}. Lancez la génération pour afficher
              les soldes par compte.
            </p>
          </div>
        }
      >
        {query.data && <TrialBalanceResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
