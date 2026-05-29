'use client';

/**
 * Console Grand livre — détail d'UN compte sur une plage (`range`). Branchée sur
 * `GET /organizations/:org/reports/general-ledger/:accountId`. Le périmètre est
 * le compte analysé, chargé depuis le plan comptable de l'organisation.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { AccountView } from '@/types/accounting-plan';
import type { GeneralLedgerReport } from '@/types/reports';

import { GlResult } from './gl-result';
import { defaultPeriod, summarizePeriod } from './presets';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityAsOf } from './validity';

const MODE = 'general-ledger';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly accountId: string;
  readonly fromDate: string;
  readonly toDate: string;
}

export function GlConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('range'));
  const [accountId, setAccountId] = useState('');
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Lecture du compte…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const accountsQuery = useQuery<ReadonlyArray<AccountView>, ApiError>({
    queryKey: ['chart-of-accounts', orgId],
    queryFn: async () => {
      const data = await api.get<{ accounts: ReadonlyArray<AccountView> }>(
        `/organizations/${orgId}/chart-of-accounts`,
      );
      return data.accounts;
    },
    enabled: orgId !== '',
  });

  const accounts = useMemo(
    () => (accountsQuery.data ?? []).slice().sort((a, b) => a.code.localeCompare(b.code)),
    [accountsQuery.data],
  );

  // Pré-sélectionne le premier compte pour éviter une génération sans cible.
  useEffect(() => {
    if (accountId === '' && accounts.length > 0) setAccountId(accounts[0]!.id);
  }, [accounts, accountId]);

  const query = useQuery<GeneralLedgerReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const params = new URLSearchParams({ fromDate: submitted.fromDate, toDate: submitted.toDate });
      const data = await api.get<{ report: GeneralLedgerReport }>(
        `/organizations/${orgId}/reports/general-ledger/${submitted.accountId}?${params.toString()}`,
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
        setProgress({ value, stage: 'Lecture du compte…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
      record(scopeOrg, MODE, period, durationMs, { accountId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query.dataUpdatedAt]);

  const runGeneration = (): void => {
    if (period.kind !== 'range' || accountId === '') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Lecture du compte…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({ accountId, fromDate: period.fromDate, toDate: period.toDate });
  };

  const download = (ext: 'xlsx' | 'pdf'): void => {
    if (submitted === null) return;
    const params = new URLSearchParams({ fromDate: submitted.fromDate, toDate: submitted.toDate });
    void api.download(
      `/organizations/${orgId}/reports/general-ledger/${submitted.accountId}.${ext}?${params.toString()}`,
      `grand-livre.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data ? validityAsOf(query.data.toDate) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Détail chronologique des écritures d’un compte sur la période, avec solde progressif et
        lettrage. Seules les écritures committées au journal sont projetées.
      </p>

      {accountsQuery.isError && <FormError error={accountsQuery.error} />}
      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Grand livre"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        scope={{ accountId }}
        onApplyScope={(s) => {
          if (typeof s.accountId === 'string') setAccountId(s.accountId);
        }}
        scopeControls={
          <label className="space-y-1">
            <span className="text-2xs uppercase tracking-wider text-ink-soft">Compte</span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={accounts.length === 0}
              className="h-9 w-64 max-w-[60vw] rounded-sm border border-line-strong bg-paper px-2 text-sm text-ink focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none disabled:opacity-50"
            >
              {accounts.length === 0 ? (
                <option value="">{accountsQuery.isLoading ? 'Chargement…' : 'Plan indisponible'}</option>
              ) : (
                accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.label}
                  </option>
                ))
              )}
            </select>
          </label>
        }
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucun grand livre généré pour le moment</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)}. Choisissez un compte puis lancez la
              génération.
            </p>
          </div>
        }
      >
        {query.data && <GlResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
