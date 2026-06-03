'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  HelpCircle,
  Lightbulb,
  ShieldCheck,
  ShieldX,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Hint } from '@/components/ui/hint';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';
import type {
  ComplianceCheckResult,
  ComplianceVerdict,
  SyscohadaComplianceReport,
  SyscohadaComplianceResponse,
} from '@/types/syscohada-compliance';
import type { SyscohadaControlSeverity } from '@/types/syscohada-knowledge';

/* ─── Libellés ───────────────────────────────────────────────── */

const DOMAIN_LABELS: Record<string, string> = {
  'accounting-plan': 'Plan comptable',
  journals: 'Journaux et écritures',
  assets: 'Immobilisations',
  inventory: 'Inventaire et stocks',
  tva: 'TVA et fiscalité',
  reports: 'États financiers',
  leases: 'Contrats de location',
  provisions: 'Provisions',
  impairments: 'Dépréciations',
  subsidies: 'Subventions',
  'actuarial-commitments': 'Engagements actuariels',
  regularizations: 'Régularisations',
  'business-combinations': 'Fusions et regroupements',
  'bills-of-exchange': 'Effets de commerce',
  'multi-currency': 'Multi-devises',
  'pledged-assets': 'Actifs nantis',
  'cash-flow': 'Tableau des flux de trésorerie',
  'bank-reconciliation': 'Rapprochement bancaire',
  ai: 'Assistance métier',
};

function domainLabel(domain: string): string {
  if (DOMAIN_LABELS[domain]) return DOMAIN_LABELS[domain];
  const s = domain.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const SEVERITY_META: Record<SyscohadaControlSeverity, { label: string; className: string }> = {
  blocking: { label: 'Bloquant', className: 'bg-critical-soft text-critical-ink' },
  warning: { label: 'À corriger', className: 'bg-warn-soft text-warn-ink' },
  info: { label: 'Bonne pratique', className: 'bg-info-soft text-info-ink' },
};

const VERDICT_META: Record<
  ComplianceVerdict,
  {
    label: string;
    description: string;
    tone: 'accent' | 'warn' | 'critical';
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  }
> = {
  compliant: {
    label: 'Conforme',
    description: 'Aucune anomalie détectée sur les contrôles évalués.',
    tone: 'accent',
    icon: ShieldCheck,
  },
  partial: {
    label: 'Sous réserves',
    description: 'Des avertissements à corriger, sans non-conformité bloquante.',
    tone: 'warn',
    icon: AlertTriangle,
  },
  non_compliant: {
    label: 'Non conforme',
    description: 'Au moins un contrôle bloquant est en échec — à corriger avant dépôt.',
    tone: 'critical',
    icon: ShieldX,
  },
};

function toneBorder(tone: 'accent' | 'warn' | 'critical'): string {
  if (tone === 'accent') return 'border-accent/40';
  if (tone === 'warn') return 'border-warn/40';
  return 'border-critical/40';
}

function toneChip(tone: 'accent' | 'warn' | 'critical'): string {
  if (tone === 'accent') return 'bg-accent-soft text-accent-ink';
  if (tone === 'warn') return 'bg-warn-soft text-warn-ink';
  return 'bg-critical-soft text-critical-ink';
}

/** Ordre d'affichage : anomalies d'abord (bloquant > warning > info), puis
 *  non évaluables, puis conformes. */
function sortKey(r: ComplianceCheckResult): number {
  if (r.status === 'fail') {
    const sev = r.control?.severity;
    return sev === 'blocking' ? 0 : sev === 'warning' ? 1 : 2;
  }
  if (r.status === 'not_evaluable') return 3;
  return 4;
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function SyscohadaCompliancePage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');

  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const data = await api.get<{ periods: ReadonlyArray<AccountingPeriodView> }>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return data.periods;
    },
    enabled: orgId !== '',
  });

  const exercises = useMemo(
    () =>
      (periodsQuery.data ?? [])
        .filter((p) => p.parentId === null)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [periodsQuery.data],
  );

  useEffect(() => {
    const first = exercises[0];
    if (selectedExerciseId === '' && first !== undefined) {
      setSelectedExerciseId(first.id);
    }
  }, [selectedExerciseId, exercises]);

  const exercise = useMemo(
    () => exercises.find((e) => e.id === selectedExerciseId) ?? null,
    [exercises, selectedExerciseId],
  );

  const reportQuery = useQuery<SyscohadaComplianceReport, ApiError>({
    queryKey: ['syscohada-compliance', orgId, exercise?.startDate, exercise?.endDate],
    queryFn: async () => {
      const params = new URLSearchParams({
        fiscalYearStartDate: exercise!.startDate,
        asAtDate: exercise!.endDate,
      });
      const data = await api.get<SyscohadaComplianceResponse>(
        `/organizations/${orgId}/syscohada-compliance?${params.toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && exercise !== null,
  });

  const report = reportQuery.data;
  const sortedResults = useMemo(
    () => (report ? [...report.results].sort((a, b) => sortKey(a) - sortKey(b)) : []),
    [report],
  );
  const anomalies = sortedResults.filter((r) => r.status === 'fail');

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-10">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Analyse &amp; conformité · Acte uniforme</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Conformité SYSCOHADA
          </h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Le moteur évalue vos écritures et vos états contre les contrôles de l&apos;Acte uniforme
            (AUDCIF). Chaque anomalie est citée par son article et accompagnée de la correction à
            apporter.
          </p>
        </header>

        <Hint id="conformite-intro" variant="learn">
          Ce rapport détecte automatiquement les incohérences (écritures déséquilibrées, comptes au
          sens anormal, dates hors période, comptes d&apos;attente non soldés, TVA mal imputée…). Un
          contrôle <strong>bloquant</strong> en échec rend l&apos;exercice « non conforme » ; les
          avertissements le placent « sous réserves ». Corrigez les anomalies puis réévaluez.
        </Hint>

        {/* ─── Sélecteur d'exercice ───────────────────────── */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
          <div className="min-w-[260px] space-y-1.5">
            <Label htmlFor="exercise">Exercice évalué</Label>
            <select
              id="exercise"
              className="flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
              value={selectedExerciseId}
              onChange={(e) => setSelectedExerciseId(e.target.value)}
              disabled={periodsQuery.isLoading}
            >
              {exercises.length === 0 && <option value="">— aucun exercice —</option>}
              {exercises.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.label}
                </option>
              ))}
            </select>
          </div>
          {report && (
            <p className="text-xs text-ink-mute">
              Arrêté au{' '}
              <span className="font-mono tabular-nums text-ink-soft">{report.asAtDate}</span>
            </p>
          )}
        </div>

        {/* ─── Corps ──────────────────────────────────────── */}
        {periodsQuery.isLoading || reportQuery.isLoading ? (
          <ReportSkeleton />
        ) : exercises.length === 0 ? (
          <EmptyState
            icon={BookOpenCheck}
            title="Aucun exercice"
            description="Ouvrez un exercice comptable pour lancer une évaluation de conformité."
          />
        ) : reportQuery.error ? (
          <ErrorBlock message={`Évaluation indisponible : ${reportQuery.error.message}`} />
        ) : report ? (
          <>
            <VerdictBanner report={report} anomalyCount={anomalies.length} />
            <ResultsList results={sortedResults} />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

/* ─── Bandeau verdict ────────────────────────────────────────── */

function VerdictBanner({
  report,
  anomalyCount,
}: {
  report: SyscohadaComplianceReport;
  anomalyCount: number;
}) {
  const meta = VERDICT_META[report.verdict];
  const Icon = meta.icon;
  return (
    <section className={cn('rounded-sm border bg-paper p-6', toneBorder(meta.tone))}>
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <span
            className={cn(
              'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
              toneChip(meta.tone),
            )}
          >
            <Icon className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <div>
            <p className="eyebrow mb-1">Verdict</p>
            <p className="font-display text-2xl font-medium leading-none text-ink">{meta.label}</p>
            <p className="mt-1.5 max-w-[48ch] text-xs text-ink-mute">{meta.description}</p>
          </div>
        </div>
        <dl className="flex gap-6 text-right">
          <Stat label="Conformes" value={report.counts.pass} tone="accent" />
          <Stat label="Anomalies" value={report.counts.fail} tone={anomalyCount > 0 ? 'critical' : 'accent'} />
          <Stat label="Non évaluées" value={report.counts.notEvaluable} tone="warn" />
        </dl>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'accent' | 'warn' | 'critical';
}) {
  const color =
    value === 0
      ? 'text-ink-mute'
      : tone === 'accent'
        ? 'text-accent-ink'
        : tone === 'warn'
          ? 'text-warn-ink'
          : 'text-critical-ink';
  return (
    <div>
      <dd className={cn('font-mono text-2xl font-semibold tabular-nums', color)}>{value}</dd>
      <dt className="mt-0.5 text-2xs uppercase tracking-wider text-ink-mute">{label}</dt>
    </div>
  );
}

/* ─── Liste des résultats ────────────────────────────────────── */

function ResultsList({ results }: { results: ReadonlyArray<ComplianceCheckResult> }) {
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-display text-xl font-medium text-ink">Contrôles évalués</h2>
        <span className="font-mono text-xs uppercase tracking-wider text-ink-mute">
          {results.length} contrôle{results.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="divide-y divide-line rounded-sm border border-line bg-paper">
        {results.map((result) => (
          <ResultRow key={result.controlId} result={result} />
        ))}
      </div>
    </section>
  );
}

function ResultRow({ result }: { result: ComplianceCheckResult }) {
  const isFail = result.status === 'fail';
  const isNa = result.status === 'not_evaluable';
  const label = result.control?.label ?? result.controlId;
  const severity = result.control?.severity;

  return (
    <div className="px-5 py-5">
      <div className="flex items-start gap-3">
        <StatusIcon status={result.status} severity={severity} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium text-ink">{label}</p>
            <span className="text-2xs uppercase tracking-wider text-ink-mute">
              {domainLabel(result.domain)}
            </span>
            {isFail && severity && (
              <span
                className={cn(
                  'rounded-xs px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wider',
                  SEVERITY_META[severity].className,
                )}
              >
                {SEVERITY_META[severity].label}
              </span>
            )}
          </div>
          <p
            className={cn(
              'mt-1 text-xs',
              isFail ? 'text-ink-soft' : isNa ? 'text-ink-mute' : 'text-ink-mute',
            )}
          >
            {result.detail}
          </p>

          {/* Base légale AUDCIF */}
          {result.control && result.control.legalBasis.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.control.legalBasis.map((basis) => (
                <span key={basis} className="rounded-xs bg-sunk px-1.5 py-0.5 text-2xs text-ink-mute">
                  {basis}
                </span>
              ))}
            </div>
          )}

          {/* Recommandation (anomalie) */}
          {isFail && result.recommendation && (
            <div className="mt-3 flex items-start gap-2 rounded-xs bg-warn-soft px-3 py-2">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-ink" strokeWidth={1.5} />
              <p className="text-xs text-warn-ink">{result.recommendation}</p>
            </div>
          )}

          {/* Extrait verbatim du Guide / Acte uniforme */}
          {result.control?.citation && (
            <blockquote className="mt-2 rounded-xs bg-sunk px-3 py-2">
              <p className="text-xs italic text-ink-soft">
                « {result.control.citation.excerpt.slice(0, 200)}
                {result.control.citation.excerpt.length > 200 ? '…' : ''} »
              </p>
              <p className="mt-1 text-2xs text-ink-mute">
                {result.control.citation.tome > 0
                  ? `Tome ${result.control.citation.tome}, ${result.control.citation.sourceTitle}`
                  : result.control.citation.sourceTitle}{' '}
                · lignes {result.control.citation.lineStart}-{result.control.citation.lineEnd}
              </p>
            </blockquote>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({
  status,
  severity,
}: {
  status: ComplianceCheckResult['status'];
  severity?: SyscohadaControlSeverity;
}) {
  if (status === 'pass') {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft">
        <Check className="h-3 w-3 text-accent-ink" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'not_evaluable') {
    return (
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sunk">
        <HelpCircle className="h-3 w-3 text-ink-mute" strokeWidth={2} />
      </span>
    );
  }
  const cls = severity === 'blocking' ? 'bg-critical-soft text-critical-ink' : 'bg-warn-soft text-warn-ink';
  return (
    <span className={cn('mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full', cls)}>
      <AlertTriangle className="h-3 w-3" strokeWidth={2} />
    </span>
  );
}

/* ─── États (vide / erreur / chargement) ─────────────────────── */

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-sm border border-dashed border-line bg-paper">
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
          <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
        </span>
        <div>
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
        </div>
      </div>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-critical/30 bg-critical-soft px-5 py-4 text-sm text-critical-ink">
      {message}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="animate-pulse space-y-8" aria-hidden>
      <div className="flex items-center gap-4 rounded-sm border border-line bg-paper p-6">
        <div className="h-12 w-12 rounded-full bg-sunk" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-16 rounded-xs bg-sunk" />
          <div className="h-5 w-40 rounded-xs bg-sunk" />
        </div>
      </div>
      <div className="divide-y divide-line rounded-sm border border-line bg-paper">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-5 py-5">
            <div className="h-5 w-5 rounded-full bg-sunk" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-1/2 rounded-xs bg-sunk" />
              <div className="h-3 w-3/4 rounded-xs bg-sunk" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
