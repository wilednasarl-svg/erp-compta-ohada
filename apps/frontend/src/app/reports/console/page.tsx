'use client';

/**
 * `/reports/console` — parcours « Report Console » câblé sur le vrai Bilan.
 *
 * Parcours unifié (guide ① Période → ② Périmètre → ③ Générer) servant aussi
 * bien le profil occasionnel que l'expert, branché sur l'endpoint réel
 * `GET /organizations/:org/reports/balance-sheet`. Aucune donnée fabriquée :
 * la validité affichée est dérivée du rapport généré (équilibre Actif=Passif).
 * Un endpoint de validité pré-génération reste à ajouter côté backend.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { BalanceSheetReport } from '@/types/reports';

import { BalanceSheetResult } from '../_console/balance-sheet-result';
import { defaultPeriod, fromIso, summarizePeriod, toIso } from '../_console/presets';
import { ReportRunner } from '../_console/report-runner';
import { useHistoryStore } from '../_console/stores';
import type { PeriodValue, RunStatus } from '../_console/types';
import { validityFromBalanceSheet } from '../_console/validity';

const MODE = 'balance-sheet';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
  readonly compareAsAtDate?: string;
  readonly compareFiscalYearStartDate?: string;
}

/** Décale une date ISO d'un nombre d'années (pour dériver la comparaison N-1). */
const shiftYears = (iso: string, delta: number): string => {
  const d = fromIso(iso);
  return toIso(new Date(d.getFullYear() + delta, d.getMonth(), d.getDate(), 12));
};

const buildParams = (s: SubmittedParams): URLSearchParams => {
  const p = new URLSearchParams({ asAtDate: s.asAtDate, fiscalYearStartDate: s.fiscalYearStartDate });
  if (s.compareAsAtDate !== undefined) p.set('compareAsAtDate', s.compareAsAtDate);
  if (s.compareFiscalYearStartDate !== undefined) {
    p.set('compareFiscalYearStartDate', s.compareFiscalYearStartDate);
  }
  return p;
};

export default function ReportConsolePage() {
  const org = useCurrentOrg();
  const orgId = org?.id ?? '';

  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('as-at'));
  const [compare, setCompare] = useState(true);
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Génération du bilan…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const query = useQuery<BalanceSheetReport, ApiError>({
    queryKey: ['reports-console', 'balance-sheet', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: BalanceSheetReport }>(
        `/organizations/${orgId}/reports/balance-sheet?${buildParams(submitted).toString()}`,
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

  // Progression estimée par le temps écoulé, plafonnée à 90 % tant que la
  // requête n'a pas répondu (l'API n'expose pas d'avancement réel).
  useEffect(() => {
    if (status === 'running') {
      if (timer.current) clearInterval(timer.current);
      const begin = startedAtRef.current || Date.now();
      timer.current = setInterval(() => {
        const elapsed = Date.now() - begin;
        const value = Math.min(0.9, elapsed / PROGRESS_TARGET_MS);
        setProgress({ value, stage: 'Génération du bilan…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
      }, 80);
    } else {
      if (timer.current) clearInterval(timer.current);
      if (status === 'ready') setProgress((p) => ({ ...p, value: 1 }));
    }
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [status]);

  // Enregistre l'exécution dans l'historique à chaque nouveau rapport.
  useEffect(() => {
    if (status === 'ready' && query.dataUpdatedAt && String(query.dataUpdatedAt) !== lastRecorded.current) {
      lastRecorded.current = String(query.dataUpdatedAt);
      const durationMs = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
      record(orgId || 'anon', MODE, period, durationMs, { compare });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query.dataUpdatedAt]);

  const runGeneration = (): void => {
    if (period.kind !== 'as-at') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Génération du bilan…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({
      asAtDate: period.asAtDate,
      fiscalYearStartDate: period.fiscalYearStartDate,
      ...(compare
        ? {
            compareAsAtDate: shiftYears(period.asAtDate, -1),
            compareFiscalYearStartDate: shiftYears(period.fiscalYearStartDate, -1),
          }
        : {}),
    });
  };

  const download = (ext: 'xlsx' | 'pdf'): void => {
    if (submitted === null) return;
    void api.download(
      `/organizations/${orgId}/reports/balance-sheet.${ext}?${buildParams(submitted).toString()}`,
      `bilan.${ext}`,
    );
  };

  const validity = query.data ? validityFromBalanceSheet(query.data) : undefined;

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="border-b border-line pb-5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">États · Reporting OHADA</p>
          <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">Bilan</h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">
            Patrimoine et financement à une date donnée, conforme SYSCOHADA AUDCIF. Choisissez la
            date d’arrêté, activez la comparaison N-1 si besoin, puis générez. L’équilibre
            Actif = Passif est contrôlé sur le rapport généré.
          </p>
        </header>

        {query.isError && <FormError error={query.error} />}

        <ReportRunner
          orgId={orgId || 'anon'}
          mode={MODE}
          periodLabel="Bilan"
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
              <p className="text-sm font-medium text-ink">Aucun bilan généré pour le moment</p>
              <p className="text-sm text-ink-soft">
                Période sélectionnée : {summarizePeriod(period)}. Lancez la génération pour afficher
                l’actif et le passif.
              </p>
            </div>
          }
        >
          {query.data && <BalanceSheetResult report={query.data} />}
        </ReportRunner>
      </div>
    </AppShell>
  );
}
