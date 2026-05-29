'use client';

/**
 * Console Marge par axe analytique — plage (`range`) + axe analytique
 * (chantier, projet…) chargé depuis `/reports/analytic-axes`. Branchée sur
 * `GET /organizations/:org/reports/margin-by-axis`.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { FormError } from '@/components/ui/form-error';
import { ApiError, api } from '@/lib/api-client';
import type { AnalyticAxisSummary, MarginByAxisReport } from '@/types/reports';

import { MarginResult } from './margin-result';
import { defaultPeriod, summarizePeriod } from './presets';
import { ReportRunner } from './report-runner';
import { useHistoryStore } from './stores';
import type { PeriodValue, RunStatus } from './types';
import { usePeriodValidity } from './use-period-validity';
import { validityAsOf } from './validity';

const MODE = 'margin-by-axis';
const PROGRESS_TARGET_MS = 1500;

interface SubmittedParams {
  readonly fromDate: string;
  readonly toDate: string;
  readonly axisType: string;
}

const buildParams = (s: SubmittedParams): URLSearchParams =>
  new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate, axisType: s.axisType });

export function MarginConsole({ orgId }: { readonly orgId: string }) {
  const scopeOrg = orgId || 'anon';
  const [period, setPeriod] = useState<PeriodValue>(() => defaultPeriod('range'));
  const [axisType, setAxisType] = useState('');
  const [submitted, setSubmitted] = useState<SubmittedParams | null>(null);
  const [progress, setProgress] = useState({ value: 0, stage: 'Calcul des marges…', etaMs: PROGRESS_TARGET_MS });

  const startedAtRef = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRecorded = useRef<string>('');
  const record = useHistoryStore((s) => s.record);

  const axesQuery = useQuery<ReadonlyArray<AnalyticAxisSummary>, ApiError>({
    queryKey: ['analytic-axes', orgId],
    queryFn: async () => {
      const data = await api.get<{ axes: ReadonlyArray<AnalyticAxisSummary> }>(
        `/organizations/${orgId}/reports/analytic-axes`,
      );
      return data.axes;
    },
    enabled: orgId !== '',
  });

  const axisTypes = useMemo(
    () => Array.from(new Set((axesQuery.data ?? []).map((a) => a.axisType))).sort(),
    [axesQuery.data],
  );

  useEffect(() => {
    if (axisType === '' && axisTypes.length > 0) setAxisType(axisTypes[0]!);
  }, [axisTypes, axisType]);

  const query = useQuery<MarginByAxisReport, ApiError>({
    queryKey: ['reports-console', MODE, orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<{ report: MarginByAxisReport }>(
        `/organizations/${orgId}/reports/margin-by-axis?${buildParams(submitted).toString()}`,
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
        setProgress({ value, stage: 'Calcul des marges…', etaMs: Math.max(0, PROGRESS_TARGET_MS - elapsed) });
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
      record(scopeOrg, MODE, period, durationMs, { axisType });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, query.dataUpdatedAt]);

  const runGeneration = (): void => {
    if (period.kind !== 'range' || axisType === '') return;
    startedAtRef.current = Date.now();
    setProgress({ value: 0, stage: 'Calcul des marges…', etaMs: PROGRESS_TARGET_MS });
    setSubmitted({ fromDate: period.fromDate, toDate: period.toDate, axisType });
  };

  const download = (ext: 'xlsx' | 'pdf'): void => {
    if (submitted === null) return;
    void api.download(
      `/organizations/${orgId}/reports/margin-by-axis.${ext}?${buildParams(submitted).toString()}`,
      `marge-analytique.${ext}`,
    );
  };

  const livePreGen = usePeriodValidity(orgId, period);
  const validity = query.data ? validityAsOf(query.data.toDate) : livePreGen;

  return (
    <div className="space-y-5">
      <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
        Rentabilité par axe analytique (chantier, projet, centre…) : chiffre d’affaires, marge brute,
        valeur ajoutée, EBE et résultat, ligne par ligne sur la période.
      </p>

      {axesQuery.isError && <FormError error={axesQuery.error} />}
      {query.isError && <FormError error={query.error} />}

      <ReportRunner
        orgId={scopeOrg}
        mode={MODE}
        periodLabel="Marge analytique"
        period={period}
        onPeriodChange={setPeriod}
        validity={validity}
        status={status}
        progress={progress}
        onGenerate={runGeneration}
        onExport={download}
        scope={{ axisType }}
        onApplyScope={(s) => {
          if (typeof s.axisType === 'string') setAxisType(s.axisType);
        }}
        scopeControls={
          <label className="space-y-1">
            <span className="text-2xs uppercase tracking-wider text-ink-soft">Axe</span>
            <select
              value={axisType}
              onChange={(e) => setAxisType(e.target.value)}
              disabled={axisTypes.length === 0}
              className="h-9 w-48 rounded-sm border border-line-strong bg-paper px-2 text-sm text-ink focus-visible:border-accent focus-visible:shadow-input focus-visible:outline-none disabled:opacity-50"
            >
              {axisTypes.length === 0 ? (
                <option value="">{axesQuery.isLoading ? 'Chargement…' : 'Aucun axe'}</option>
              ) : (
                axisTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))
              )}
            </select>
          </label>
        }
        emptyHint={
          <div className="space-y-1">
            <p className="text-sm font-medium text-ink">Aucune marge analytique générée</p>
            <p className="text-sm text-ink-soft">
              Période sélectionnée : {summarizePeriod(period)}. Choisissez un axe puis lancez la
              génération.
            </p>
          </div>
        }
      >
        {query.data && <MarginResult report={query.data} />}
      </ReportRunner>
    </div>
  );
}
