'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BookOpen,
  BookText,
  Calendar,
  CheckCircle2,
  Clock,
  FileUp,
  Link2,
  Loader2,
  Percent,
  Scale,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { AppShell } from '@/components/app-shell';
import { api, ApiError } from '@/lib/api-client';
import { useCurrentOrg, useCurrentUser } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';

/* ─── Types ──────────────────────────────────────────────────── */

interface DaySummaryPending {
  entries: number;
  bankLines: number;
  auxLettering: number;
  tvaDeclarations: number;
}

interface DaySummaryActivity {
  module: string;
  action: string;
  entityType: string | null;
  createdAt: string;
}

interface DaySummary {
  pending: DaySummaryPending;
  exercise: { label: string; startDate: string; endDate: string } | null;
  activePeriod: { label: string; endDate: string } | null;
  entriesThisMonth: number;
  pendingThisMonth: number;
  score: { value: number; grade: string } | null;
  recentActivity: DaySummaryActivity[];
}

/* ─── Onboarding steps ───────────────────────────────────────── */

interface OnboardingStep {
  href: string;
  label: string;
  description: string;
  done: boolean;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

function buildOnboardingSteps(s: DaySummary | undefined): OnboardingStep[] {
  const hasExercise = !!s?.exercise;
  const hasEntries = (s?.entriesThisMonth ?? 0) > 0;

  return [
    {
      href: '/chart-of-accounts',
      label: 'Vérifier le plan comptable',
      description: 'SYSCOHADA pré-chargé — adaptez les comptes auxiliaires si nécessaire.',
      done: true,
      icon: BookOpen,
    },
    {
      href: '/accounting-periods',
      label: "Ouvrir l'exercice comptable",
      description: 'Définissez la période de départ et la date de clôture.',
      done: hasExercise,
      icon: Calendar,
    },
    {
      href: '/journals',
      label: 'Paramétrer les journaux',
      description: 'Journaux de vente, achat, banque et opérations diverses.',
      done: hasEntries,
      icon: BookText,
    },
    {
      href: '/imports',
      label: 'Importer les premières écritures',
      description: 'Sage Saari, CSV ou saisie manuelle — votre choix.',
      done: hasEntries,
      icon: FileUp,
    },
  ];
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function DashboardPage() {
  const user = useCurrentUser();
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const [viewMode, setViewMode] = useState<'dg' | 'daf' | 'op'>('dg');
  const [primaryExerciseId, setPrimaryExerciseId] = useState<string>('');
  const [compExerciseId, setCompExerciseId] = useState<string>('');

  const now = new Date();
  const dayName = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  const dayMonth = now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const year = now.getFullYear().toString();

  const { data, isLoading } = useQuery<{ daySummary: DaySummary }, ApiError>({
    queryKey: ['day-summary', orgId],
    queryFn: () => api.get<{ daySummary: DaySummary }>(`/organizations/${orgId}/dashboards/day-summary`),
    enabled: orgId !== '',
    staleTime: 60_000,
  });

  const { data: periodsData } = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const resp = await api.get<{ periods: ReadonlyArray<AccountingPeriodView> }>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return resp.periods;
    },
    enabled: orgId !== '',
  });

  const rootPeriods = useMemo(
    () =>
      (periodsData ?? [])
        .filter((p) => p.parentId === null)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [periodsData],
  );

  const s = data?.daySummary;

  useEffect(() => {
    if (!primaryExerciseId && rootPeriods.length > 0) {
      setPrimaryExerciseId(rootPeriods[0]!.id);
    }
  }, [rootPeriods, primaryExerciseId]);

  const onboardingSteps = useMemo(() => buildOnboardingSteps(s), [s]);
  const onboardingDoneCount = onboardingSteps.filter((step) => step.done).length;
  const showOnboarding = !isLoading && !s?.exercise;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] animate-page-in space-y-10">

        {/* ─── En-tête éditorial ────────────────────────────── */}
        <header>
          <p className="eyebrow mb-3">
            {dayName.charAt(0).toUpperCase() + dayName.slice(1)}
          </p>
          <div className="flex items-baseline gap-4">
            <h1 className="font-display text-5xl font-medium tracking-tight text-ink sm:text-6xl">
              {dayMonth.charAt(0).toUpperCase() + dayMonth.slice(1)}
            </h1>
            <span className="font-display text-2xl font-medium text-ink-mute">{year}</span>
          </div>
          <div className="mt-4 h-px w-full bg-line" aria-hidden />
          <p className="mt-4 text-sm text-ink-soft">
            Dossier{' '}
            <span className="font-medium text-ink">{currentOrg?.name ?? '—'}</span>
            {' · '}
            <span className="text-ink-mute">{currentOrg?.role ?? '—'}</span>
            {' · '}
            Bonjour{' '}
            <span className="font-medium text-ink">
              {user?.firstName ?? user?.email?.split('@')[0] ?? ''}
            </span>
          </p>
        </header>

        {/* ─── Sélecteur de vue ─────────────────────────────── */}
        <div className="flex items-center border-b border-line pb-4 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-1 rounded-full bg-sunk/50 p-1 whitespace-nowrap">
            {(
              [
                { key: 'dg', label: 'Direction', sub: 'Synthèse' },
                { key: 'daf', label: 'Finances', sub: 'DAF' },
                { key: 'op', label: 'Opérationnel', sub: 'Comptable' },
              ] as const
            ).map(({ key, label, sub }) => (
              <button
                key={key}
                type="button"
                onClick={() => setViewMode(key)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-300 ${
                  viewMode === key
                    ? 'bg-paper text-ink shadow-sm ring-1 ring-line'
                    : 'text-ink-mute hover:text-ink-soft'
                }`}
              >
                {label}
                <span className="ml-1 text-xs font-normal opacity-60">({sub})</span>
              </button>
            ))}
          </div>
        </div>

        {/* ─── Filtres exercice ─────────────────────────────── */}
        {(viewMode === 'dg' || viewMode === 'daf') && (
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-ink-mute">Exercice :</label>
              <select
                value={primaryExerciseId}
                onChange={(e) => {
                  setPrimaryExerciseId(e.target.value);
                  if (compExerciseId === e.target.value) setCompExerciseId('');
                }}
                className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Sélectionner…</option>
                {rootPeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-ink-mute">Comparer avec :</label>
              <select
                value={compExerciseId}
                onChange={(e) => setCompExerciseId(e.target.value)}
                className="rounded-md border border-line bg-paper px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Aucun</option>
                {rootPeriods.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id === primaryExerciseId}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ─── Contenu selon la vue ─────────────────────────── */}
        {viewMode === 'dg' ? (
          <DgDashboardView
            orgId={orgId}
            exerciseId={primaryExerciseId}
            compExerciseId={compExerciseId}
            rootPeriods={rootPeriods as AccountingPeriodView[]}
          />
        ) : viewMode === 'daf' ? (
          <DafDashboardView
            orgId={orgId}
            exerciseId={primaryExerciseId}
            compExerciseId={compExerciseId}
            rootPeriods={rootPeriods as AccountingPeriodView[]}
          />
        ) : (
          <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* ─── Initialisation du dossier ────────────────── */}
            {showOnboarding && (
              <section className="rounded-lg border border-line bg-paper p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="eyebrow mb-1">Démarrage</p>
                    <h2 className="font-display text-xl font-medium text-ink">
                      Initialisation du dossier
                    </h2>
                    <p className="mt-1 text-sm text-ink-mute">
                      {onboardingDoneCount} sur {onboardingSteps.length} étapes complètes.
                    </p>
                  </div>
                  <OnboardingRing done={onboardingDoneCount} total={onboardingSteps.length} />
                </div>

                <ol className="space-y-3">
                  {onboardingSteps.map((step, i) => {
                    const StepIcon = step.icon;
                    return (
                      <li key={step.href} className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                            step.done
                              ? 'bg-accent-soft text-accent-ink'
                              : 'border border-line-strong text-ink-mute'
                          }`}
                        >
                          {step.done ? (
                            <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                          ) : (
                            i + 1
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <StepIcon className="h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.5} />
                            <Link
                              href={step.href}
                              className={`text-sm font-medium transition-colors duration-fast hover:text-accent-ink ${
                                step.done ? 'text-ink-soft line-through decoration-ink-mute' : 'text-ink'
                              }`}
                            >
                              {step.label}
                            </Link>
                          </div>
                          {!step.done && (
                            <p className="mt-0.5 text-xs text-ink-mute">{step.description}</p>
                          )}
                        </div>
                        {!step.done && (
                          <Link
                            href={step.href}
                            className="shrink-0 rounded-sm border border-line-strong bg-canvas px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-fast hover:bg-sunk"
                          >
                            Configurer
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* ─── Priorités du jour ────────────────────────── */}
            <section aria-labelledby="todo-title">
              <div className="mb-5 flex items-baseline justify-between gap-4">
                <div>
                  <p className="eyebrow mb-1">Priorité du jour</p>
                  <h2 id="todo-title" className="font-display text-xl font-medium text-ink">
                    À traiter
                  </h2>
                </div>
                <Link
                  href="/entry-workflow"
                  className="group inline-flex items-center gap-1 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
                >
                  <span>Workflow complet</span>
                  <ArrowUpRight
                    className="h-3 w-3 transition-transform duration-fast group-hover:-translate-y-px group-hover:translate-x-px"
                    strokeWidth={1.5}
                  />
                </Link>
              </div>

              {isLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-ink-mute">
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                  Chargement…
                </div>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line bg-paper">
                  <TaskRow
                    icon={BookText}
                    label="Écritures en attente"
                    detail="Journaux en statut brouillon — à valider"
                    actionLabel="Valider les écritures"
                    count={s?.pending.entries ?? 0}
                    href="/entry-workflow"
                    tone="warn"
                  />
                  <TaskRow
                    icon={Banknote}
                    label="Lignes bancaires à rapprocher"
                    detail="Relevés non pointés — rapprochement en cours"
                    actionLabel="Pointer le relevé"
                    count={s?.pending.bankLines ?? 0}
                    href="/bank-reconciliation"
                    tone="info"
                  />
                  <TaskRow
                    icon={Link2}
                    label="Lignes auxiliaires à lettrer"
                    detail="Comptes 40x / 41x non lettrés"
                    actionLabel="Lettrer les comptes"
                    count={s?.pending.auxLettering ?? 0}
                    href="/lettering"
                    tone="info"
                  />
                  <TaskRow
                    icon={Percent}
                    label="Déclarations TVA"
                    detail="Brouillon ou calculée — dépôt DGI en attente"
                    actionLabel="Finaliser la déclaration"
                    count={s?.pending.tvaDeclarations ?? 0}
                    href="/tva"
                    tone={s?.pending.tvaDeclarations ? 'critical' : 'info'}
                  />
                </ul>
              )}
            </section>

            {/* ─── Activité + Snapshot ──────────────────────── */}
            <section className="grid gap-12 lg:grid-cols-[1.5fr_1fr]">
              {/* Timeline activité */}
              <div>
                <p className="eyebrow mb-1">Activité du dossier</p>
                <h2 className="mb-6 font-display text-xl font-medium text-ink">
                  Derniers mouvements
                </h2>

                {isLoading ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-ink-mute">
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                  </div>
                ) : (s?.recentActivity.length ?? 0) === 0 ? (
                  <div className="rounded-lg border border-line bg-paper px-5 py-8 text-center">
                    <p className="text-sm text-ink-mute">
                      Aucune activité enregistrée sur ce dossier.
                    </p>
                    <p className="mt-1 text-xs text-ink-mute">
                      Les actions apparaîtront ici dès la première saisie.
                    </p>
                  </div>
                ) : (
                  <ActivityTimeline items={s!.recentActivity} />
                )}

                <Link
                  href="/audit-logs"
                  className="mt-6 inline-flex items-center gap-1 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
                >
                  <span>Journal d'audit complet</span>
                  <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
                </Link>
              </div>

              {/* Snapshot */}
              <div className="space-y-8 border-l border-line pl-10 lg:pl-12">
                <SnapshotBlock
                  label="Exercice en cours"
                  value={s?.exercise?.label ?? '—'}
                  sub={
                    s?.exercise
                      ? `ouvert le ${fmtDate(s.exercise.startDate)}`
                      : 'Aucun exercice ouvert'
                  }
                  emptyHref={!s?.exercise ? '/accounting-periods' : undefined}
                  emptyAction="Ouvrir un exercice"
                />
                <SnapshotBlock
                  label="Période active"
                  value={s?.activePeriod?.label ?? '—'}
                  sub={
                    s?.activePeriod
                      ? `clôture le ${fmtDate(s.activePeriod.endDate)}`
                      : 'Aucune période ouverte'
                  }
                  accent={!!s?.activePeriod}
                />
                <SnapshotBlock
                  label="Écritures du mois"
                  value={s ? fmt(s.entriesThisMonth) : '—'}
                  sub={s ? `dont ${fmt(s.pendingThisMonth)} en attente` : ''}
                  numeric
                  emptyHref={s?.entriesThisMonth === 0 ? '/journals' : undefined}
                  emptyAction="Première saisie"
                />
                <SnapshotBlock
                  label="Score santé"
                  value={s?.score ? s.score.grade : '—'}
                  sub={s?.score ? `${s.score.value} / 100` : 'Aucun score calculé'}
                  scoreValue={s?.score?.value}
                  href="/accounting-score"
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function fmt(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n);
}

function actionLabel(item: DaySummaryActivity): string {
  const labels: Record<string, string> = {
    'journal_entries.create': 'écriture créée',
    'journal_entries.validate': 'écriture validée',
    'journal_entries.cancel': 'écriture annulée',
    'imports.create': 'import démarré',
    'imports.commit': 'import validé',
    'tva.calculate': 'déclaration TVA calculée',
    'tva.cancel': 'déclaration TVA annulée',
    'bank_reconciliation.match': 'rapprochement effectué',
    'lettering.apply': 'lettrage appliqué',
    'accounting_periods.close': 'période clôturée',
    'auth.login': 'connexion',
  };
  const key = `${item.module}.${item.action}`;
  return labels[key] ?? item.action.replace(/_/g, ' ');
}

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function dotClass(item: DaySummaryActivity): string {
  const key = `${item.module}.${item.action}`;
  if (key.includes('validate') || key.includes('commit') || key.includes('close'))
    return 'bg-accent';
  if (key.includes('cancel')) return 'bg-critical';
  if (key === 'auth.login') return 'bg-ink-mute';
  return 'bg-info';
}

/* ─── Sous-composants ────────────────────────────────────────── */

interface TaskRowProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  detail: string;
  actionLabel: string;
  count: number;
  href: string;
  tone: 'info' | 'warn' | 'critical';
}

function TaskRow({ icon: Icon, label, detail, actionLabel: ctaLabel, count, href, tone }: TaskRowProps) {
  const allGood = count === 0;

  const toneText = {
    info: 'text-info-ink',
    warn: 'text-warn-ink',
    critical: 'text-critical-ink',
  }[tone];

  return (
    <li>
      <Link
        href={href}
        className="press group flex items-center gap-4 px-4 py-3.5 transition-colors duration-fast first:rounded-t-lg last:rounded-b-lg hover:bg-sunk/50"
      >
        <div className="flex w-12 shrink-0 items-center justify-center">
          {allGood ? (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft">
              <CheckCircle2 className="h-4 w-4 text-accent-ink" strokeWidth={1.5} />
            </span>
          ) : (
            <span className={`font-mono text-2xl font-medium tabular-nums leading-none ${toneText}`}>
              {count}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.5} />
            <span className="text-sm font-medium text-ink">{label}</span>
          </div>
          <div className="mt-0.5 text-xs text-ink-mute">
            {allGood ? 'Aucune action requise' : detail}
          </div>
        </div>

        {allGood ? (
          <span className="shrink-0 text-xs text-ink-mute">À jour</span>
        ) : (
          <span className="shrink-0 rounded-sm border border-line-strong bg-canvas px-2.5 py-1 text-xs font-medium text-ink opacity-0 transition-all duration-fast group-hover:opacity-100">
            {ctaLabel}
          </span>
        )}
      </Link>
    </li>
  );
}

function ActivityTimeline({ items }: { items: DaySummaryActivity[] }) {
  return (
    <ol className="relative space-y-5">
      <span aria-hidden className="absolute bottom-[10px] left-[4px] top-[10px] w-px bg-line" />

      {items.map((item, i) => (
        <li key={i} className="relative flex pl-6">
          <span
            aria-hidden
            className={`absolute left-0 top-[9px] h-[9px] w-[9px] shrink-0 rounded-full ring-2 ring-[oklch(var(--canvas))] ${dotClass(item)}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug text-ink">
              <span className="mr-1.5 inline-block rounded-xs bg-sunk px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                {item.module}
              </span>
              <span>{actionLabel(item)}</span>
              {item.entityType ? (
                <span className="text-ink-mute"> · {item.entityType}</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-ink-mute">{fmtRelative(item.createdAt)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface SnapshotBlockProps {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  numeric?: boolean;
  scoreValue?: number;
  href?: string;
  emptyHref?: string;
  emptyAction?: string;
}

function ScoreRing({ value }: { value: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);
  const strokeColor =
    value >= 70
      ? 'oklch(var(--accent))'
      : value >= 50
        ? 'oklch(var(--warn))'
        : 'oklch(var(--critical))';
  const textColor =
    value >= 70 ? 'text-accent-ink' : value >= 50 ? 'text-warn-ink' : 'text-critical-ink';

  return (
    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" className="absolute inset-0" aria-hidden>
        <circle cx="28" cy="28" r={r} stroke="oklch(var(--line-strong))" strokeWidth="3" />
        <circle
          cx="28"
          cy="28"
          r={r}
          stroke={strokeColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 28 28)"
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        />
      </svg>
      <span className={`font-mono text-xs font-medium tabular-nums ${textColor}`}>{value}</span>
    </div>
  );
}

function OnboardingRing({ done, total }: { done: number; total: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - done / total);

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden>
        <circle cx="24" cy="24" r={r} stroke="oklch(var(--line-strong))" strokeWidth="3" />
        <circle
          cx="24"
          cy="24"
          r={r}
          stroke="oklch(var(--accent))"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform="rotate(-90 24 24)"
          style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        />
      </svg>
      <span className="font-mono text-[10px] font-medium text-accent-ink">
        {done}/{total}
      </span>
    </div>
  );
}

function SnapshotBlock({
  label,
  value,
  sub,
  accent,
  numeric,
  scoreValue,
  href,
  emptyHref,
  emptyAction,
}: SnapshotBlockProps) {
  const isEmpty = value === '—' || value === '0';

  const inner = (
    <>
      <p className="eyebrow">{label}</p>
      {scoreValue !== undefined ? (
        <div className="mt-2 flex items-center gap-3">
          <ScoreRing value={scoreValue} />
          <div>
            <p
              className={`font-display text-3xl font-medium tracking-tight ${
                scoreValue >= 70
                  ? 'text-accent-ink'
                  : scoreValue >= 50
                    ? 'text-warn-ink'
                    : 'text-critical-ink'
              }`}
            >
              {value}
            </p>
            <p className="mt-0.5 text-xs text-ink-mute">{sub}</p>
          </div>
        </div>
      ) : (
        <>
          <p
            className={`mt-1.5 font-display text-3xl font-medium tracking-tight ${
              accent ? 'text-accent-ink' : isEmpty ? 'text-ink-mute' : 'text-ink'
            } ${numeric ? 'font-mono tabular-nums' : ''}`}
          >
            {value}
          </p>
          <p className="mt-1 text-xs text-ink-mute">{sub}</p>
          {isEmpty && emptyHref && emptyAction && (
            <Link
              href={emptyHref}
              className="mt-2 inline-flex items-center gap-1 text-xs text-accent-ink transition-colors duration-fast hover:underline"
            >
              {emptyAction}
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          )}
        </>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="group block transition-colors duration-fast hover:text-ink">
        {inner}
        <span className="mt-1 inline-flex items-center gap-1 text-2xs uppercase tracking-wider text-ink-mute group-hover:text-ink-soft">
          <span>Détail</span>
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
        </span>
      </Link>
    );
  }

  return <div>{inner}</div>;
}

/* ─── Vue Direction (DG) ─────────────────────────────────────── */

function DgDashboardView({
  orgId,
  exerciseId,
  compExerciseId,
  rootPeriods,
}: {
  orgId: string;
  exerciseId?: string;
  compExerciseId?: string;
  rootPeriods: AccountingPeriodView[];
}) {
  const { data: summaryData, isLoading: isLoadingSummary } = useQuery({
    queryKey: ['dashboard-summary', orgId, exerciseId],
    queryFn: () => api.get<any>(`/organizations/${orgId}/dashboards/summary?exerciseId=${exerciseId}`),
    enabled: !!orgId && !!exerciseId,
  });

  const { data: evolutionData, isLoading: isLoadingEvolution } = useQuery({
    queryKey: ['dashboard-evolution', orgId, exerciseId],
    queryFn: () =>
      api.get<any>(`/organizations/${orgId}/dashboards/evolution?exerciseId=${exerciseId}`),
    enabled: !!orgId && !!exerciseId,
  });

  const { data: cashflowData, isLoading: isLoadingCashflow } = useQuery({
    queryKey: ['dashboard-cashflow', orgId, exerciseId],
    queryFn: () =>
      api.get<any>(`/organizations/${orgId}/dashboards/cashflow?exerciseId=${exerciseId}`),
    enabled: !!orgId && !!exerciseId,
  });

  const { data: compSummaryData } = useQuery({
    queryKey: ['dashboard-summary-comp', orgId, compExerciseId],
    queryFn: () =>
      api.get<any>(`/organizations/${orgId}/dashboards/summary?exerciseId=${compExerciseId}`),
    enabled: !!orgId && !!compExerciseId,
  });
  const { data: compEvolutionData } = useQuery({
    queryKey: ['dashboard-evolution-comp', orgId, compExerciseId],
    queryFn: () =>
      api.get<any>(`/organizations/${orgId}/dashboards/evolution?exerciseId=${compExerciseId}`),
    enabled: !!orgId && !!compExerciseId,
  });
  const { data: compCashflowData } = useQuery({
    queryKey: ['dashboard-cashflow-comp', orgId, compExerciseId],
    queryFn: () =>
      api.get<any>(`/organizations/${orgId}/dashboards/cashflow?exerciseId=${compExerciseId}`),
    enabled: !!orgId && !!compExerciseId,
  });

  const summary = summaryData?.summary;
  const evolution = evolutionData?.evolution;
  const cashflow = cashflowData?.cashflow;
  const compSummary = compSummaryData?.summary;
  const compEvolution = compEvolutionData?.evolution;
  const compCashflow = compCashflowData?.cashflow;
  const isLoading = isLoadingSummary || isLoadingEvolution || isLoadingCashflow;

  if (!exerciseId) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm font-medium text-ink">Sélectionnez un exercice</p>
        <p className="text-xs text-ink-mute">
          Choisissez un exercice dans le sélecteur ci-dessus pour consulter le tableau de bord.
        </p>
        <Link
          href="/accounting-periods"
          className="mt-2 rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-xs font-medium text-ink transition-colors duration-fast hover:bg-sunk"
        >
          Gérer les exercices
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-mute">
        <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.5} />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-ink-mute">
        Impossible de charger les données du tableau de bord.
      </div>
    );
  }

  const tresorerie = parseFloat(summary.cashBalance || '0');
  const bfr = parseFloat(summary.receivables || '0') - parseFloat(summary.payables || '0');
  const rev = parseFloat(summary.revenueYtd || '0');
  const net = parseFloat(summary.netResultYtd || '0');
  const margeNette = rev > 0 ? (net / rev) * 100 : 0;
  const rec = parseFloat(summary.receivables || '0');
  const dso = rev > 0 ? (rec / rev) * 365 : 0;

  let compTresorerie = 0, compBfr = 0, compMargeNette = 0, compDso = 0;
  if (compSummary) {
    compTresorerie = parseFloat(compSummary.cashBalance || '0');
    compBfr = parseFloat(compSummary.receivables || '0') - parseFloat(compSummary.payables || '0');
    const cRev = parseFloat(compSummary.revenueYtd || '0');
    const cNet = parseFloat(compSummary.netResultYtd || '0');
    compMargeNette = cRev > 0 ? (cNet / cRev) * 100 : 0;
    const cRec = parseFloat(compSummary.receivables || '0');
    compDso = cRev > 0 ? (cRec / cRev) * 365 : 0;
  }

  const formatter = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: summary.currency || 'XOF',
    maximumFractionDigits: 0,
  });

  function getTrend(
    current: number,
    previous: number | null,
    isPercentage = false,
  ): { text: string; isUp: boolean } {
    if (!compSummary || previous === null) return { text: 'N/A', isUp: true };
    const diff = current - previous;
    if (Math.abs(diff) < 0.01) return { text: '0 %', isUp: true };
    if (isPercentage) {
      return { text: `${diff > 0 ? '+' : ''}${diff.toFixed(1)} pts`, isUp: diff >= 0 };
    }
    const pct = previous !== 0 ? (diff / Math.abs(previous)) * 100 : 100;
    return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)} %`, isUp: diff >= 0 };
  }

  const trendTresorerie = getTrend(tresorerie, compSummary ? compTresorerie : null);
  const trendBfr = getTrend(bfr, compSummary ? compBfr : null);
  const trendMargeNette = getTrend(margeNette, compSummary ? compMargeNette : null, true);
  const trendDso = getTrend(dso, compSummary ? compDso : null);
  const compLabel =
    compExerciseId
      ? (rootPeriods.find((p) => p.id === compExerciseId)?.label ?? 'N-1')
      : 'mois prec.';

  const revenueChartData = (evolution?.points || []).map((p: any, idx: number) => {
    const cp = compEvolution?.points[idx];
    return {
      month: p.label.split(' ')[0],
      ca: parseFloat(p.revenue),
      margin: parseFloat(p.netResult),
      compCa: cp ? parseFloat(cp.revenue) : null,
      compMargin: cp ? parseFloat(cp.netResult) : null,
    };
  });

  const cashflowChartData = (cashflow?.points || []).map((p: any, idx: number) => {
    const cp = compCashflow?.points[idx];
    return {
      month: p.label.split(' ')[0],
      inflow: parseFloat(p.inflow),
      outflow: parseFloat(p.outflow),
      compInflow: cp ? parseFloat(cp.inflow) : null,
      compOutflow: cp ? parseFloat(cp.outflow) : null,
    };
  });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow mb-1">Vue direction</p>
          <h2 className="font-display text-xl font-medium text-ink">Pilotage de la performance</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent-ink">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          Temps réel
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Trésorerie nette"
          value={formatter.format(tresorerie)}
          trend={trendTresorerie.text}
          trendUp={trendTresorerie.isUp}
          trendLabel={`vs ${compLabel}`}
          icon={Banknote}
        />
        <KpiCard
          title="BFR"
          value={formatter.format(bfr)}
          trend={trendBfr.text}
          trendUp={!trendBfr.isUp}
          trendLabel={`vs ${compLabel}`}
          subtitle={bfr > 0 ? 'Besoin de financement' : 'Ressource de financement'}
          icon={Activity}
        />
        <KpiCard
          title="Marge nette (YTD)"
          value={`${margeNette.toFixed(1)} %`}
          trend={trendMargeNette.text}
          trendUp={trendMargeNette.isUp}
          trendLabel={`vs ${compLabel}`}
          icon={Target}
        />
        <KpiCard
          title="DSO — délai encaissement"
          value={`${Math.round(dso)} j`}
          trend={trendDso.text}
          trendUp={!trendDso.isUp}
          trendLabel={`vs ${compLabel}`}
          subtitle={dso > 60 ? 'Dérive client détectée' : 'Dans la norme'}
          icon={Clock}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-paper p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="eyebrow mb-0.5">Exercice en cours</p>
              <h3 className="font-display text-lg font-medium text-ink">
                Évolution CA et résultat net
              </h3>
            </div>
            <TrendingUp className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueChartData} margin={{ top: 10, right: 0, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCa" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="oklch(var(--accent))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="oklch(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                  {compExerciseId && (
                    <linearGradient id="colorCompCa" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(var(--ink-mute))" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="oklch(var(--ink-mute))" stopOpacity={0} />
                    </linearGradient>
                  )}
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(var(--line))" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'oklch(var(--ink-mute))' }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'oklch(var(--ink-mute))' }}
                  tickFormatter={(val) =>
                    new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(val)
                  }
                />
                <Tooltip
                  formatter={(value: number | string | readonly (string | number)[] | undefined, name: string | undefined) => [
                    new Intl.NumberFormat('fr-FR', {
                      style: 'currency',
                      currency: summary.currency || 'XOF',
                      maximumFractionDigits: 0,
                    }).format(typeof value === 'number' ? value : 0),
                    name === 'compCa'
                      ? `CA (${compLabel})`
                      : name === 'compMargin'
                        ? `Résultat net (${compLabel})`
                        : name,
                  ]}
                  contentStyle={{
                    borderRadius: '6px',
                    border: '1px solid oklch(var(--line))',
                    backgroundColor: 'oklch(var(--paper))',
                    boxShadow: '0 4px 12px oklch(18% 0.008 270 / 0.08)',
                    fontSize: '12px',
                  }}
                />
                <Legend verticalAlign="top" height={32} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                {compExerciseId && (
                  <Area
                    type="monotone"
                    dataKey="compCa"
                    name={`CA (${compLabel})`}
                    stroke="oklch(var(--ink-mute))"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorCompCa)"
                  />
                )}
                {compExerciseId && (
                  <Area
                    type="monotone"
                    dataKey="compMargin"
                    name={`Résultat net (${compLabel})`}
                    stroke="oklch(var(--ink-mute))"
                    strokeWidth={2}
                    fill="transparent"
                    strokeDasharray="3 3"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="ca"
                  name="Chiffre d'affaires"
                  stroke="oklch(var(--accent))"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorCa)"
                />
                <Area
                  type="monotone"
                  dataKey="margin"
                  name="Résultat net"
                  stroke="oklch(var(--ink))"
                  strokeWidth={2}
                  fill="transparent"
                  strokeDasharray="4 4"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-paper p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="eyebrow mb-0.5">Encaissements / Décaissements</p>
              <h3 className="font-display text-lg font-medium text-ink">Flux de trésorerie</h3>
            </div>
            <Scale className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cashflowChartData} margin={{ top: 10, right: 0, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(var(--line))" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'oklch(var(--ink-mute))' }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'oklch(var(--ink-mute))' }}
                  tickFormatter={(val) =>
                    new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(val)
                  }
                />
                <Tooltip
                  formatter={(value: number | string | readonly (string | number)[] | undefined, name: string) => [
                    new Intl.NumberFormat('fr-FR', {
                      style: 'currency',
                      currency: summary.currency || 'XOF',
                      maximumFractionDigits: 0,
                    }).format(typeof value === 'number' ? value : 0),
                    name === 'compInflow'
                      ? `Encaissements (${compLabel})`
                      : name === 'compOutflow'
                        ? `Décaissements (${compLabel})`
                        : name,
                  ]}
                  cursor={{ fill: 'oklch(var(--sunk))', opacity: 0.4 }}
                  contentStyle={{
                    borderRadius: '6px',
                    border: '1px solid oklch(var(--line))',
                    backgroundColor: 'oklch(var(--paper))',
                    fontSize: '12px',
                  }}
                />
                <Legend verticalAlign="top" height={32} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="inflow" name="Encaissements" fill="oklch(var(--accent))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Bar dataKey="outflow" name="Décaissements" fill="oklch(var(--critical))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                {compExerciseId && (
                  <Bar dataKey="compInflow" name={`Enc. (${compLabel})`} fill="oklch(var(--accent))" opacity={0.4} radius={[3, 3, 0, 0]} maxBarSize={28} />
                )}
                {compExerciseId && (
                  <Bar dataKey="compOutflow" name={`Déc. (${compLabel})`} fill="oklch(var(--critical))" opacity={0.4} radius={[3, 3, 0, 0]} maxBarSize={28} />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── KPI Card ───────────────────────────────────────────────── */

interface KpiCardProps {
  title: string;
  value: string;
  trend: string;
  trendUp: boolean;
  subtitle?: string;
  trendLabel?: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

function KpiCard({
  title,
  value,
  trend,
  trendUp,
  subtitle,
  trendLabel = 'vs mois prec.',
  icon: Icon,
}: KpiCardProps) {
  return (
    <div className="group rounded-lg border border-line bg-paper p-5 transition-all hover:border-line-strong">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-ink-mute">{title}</p>
          <p className="mt-2 font-display text-2xl font-semibold text-ink">{value}</p>
        </div>
        <div className="ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunk/50 text-ink-soft transition-colors group-hover:bg-accent/10 group-hover:text-accent-ink">
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-0.5 rounded-xs px-1.5 py-0.5 text-xs font-medium ${
              trendUp ? 'bg-info/10 text-info-ink' : 'bg-critical/10 text-critical-ink'
            }`}
          >
            {trendUp ? (
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
            ) : (
              <ArrowDownRight className="h-3 w-3" strokeWidth={1.5} />
            )}
            {trend}
          </span>
          <span className="text-xs text-ink-mute">{trendLabel}</span>
        </div>
        {subtitle && <p className="text-xs text-ink-mute">{subtitle}</p>}
      </div>
    </div>
  );
}

/* ─── Vue Finances (DAF) ─────────────────────────────────────── */

function DafDashboardView({
  orgId,
  exerciseId,
  compExerciseId,
  rootPeriods,
}: {
  orgId: string;
  exerciseId?: string;
  compExerciseId?: string;
  rootPeriods: AccountingPeriodView[];
}) {
  const { data: summaryData, isLoading: isLoadingSummary } = useQuery({
    queryKey: ['dashboard-summary', orgId, exerciseId],
    queryFn: () => api.get<any>(`/organizations/${orgId}/dashboards/summary?exerciseId=${exerciseId}`),
    enabled: !!orgId && !!exerciseId,
  });

  const { data: agingClientsData, isLoading: isLoadingAgingC } = useQuery({
    queryKey: ['dashboard-aging-clients', orgId, exerciseId],
    queryFn: () =>
      api.get<any>(`/organizations/${orgId}/dashboards/aging?exerciseId=${exerciseId}&type=clients`),
    enabled: !!orgId && !!exerciseId,
  });

  const { data: agingSuppliersData, isLoading: isLoadingAgingS } = useQuery({
    queryKey: ['dashboard-aging-suppliers', orgId, exerciseId],
    queryFn: () =>
      api.get<any>(`/organizations/${orgId}/dashboards/aging?exerciseId=${exerciseId}&type=fournisseurs`),
    enabled: !!orgId && !!exerciseId,
  });

  const { data: topExpensesData, isLoading: isLoadingTopE } = useQuery({
    queryKey: ['dashboard-top-expenses', orgId, exerciseId],
    queryFn: () =>
      api.get<any>(
        `/organizations/${orgId}/dashboards/top-accounts?exerciseId=${exerciseId}&category=expenses&limit=5`,
      ),
    enabled: !!orgId && !!exerciseId,
  });

  const { data: topRevenuesData, isLoading: isLoadingTopR } = useQuery({
    queryKey: ['dashboard-top-revenues', orgId, exerciseId],
    queryFn: () =>
      api.get<any>(
        `/organizations/${orgId}/dashboards/top-accounts?exerciseId=${exerciseId}&category=revenue&limit=5`,
      ),
    enabled: !!orgId && !!exerciseId,
  });

  const { data: compSummaryData } = useQuery({
    queryKey: ['dashboard-summary-comp', orgId, compExerciseId],
    queryFn: () =>
      api.get<any>(`/organizations/${orgId}/dashboards/summary?exerciseId=${compExerciseId}`),
    enabled: !!orgId && !!compExerciseId,
  });

  const summary = summaryData?.summary;
  const compSummary = compSummaryData?.summary;
  const agingClients = agingClientsData?.aging;
  const agingSuppliers = agingSuppliersData?.aging;
  const topExpenses = topExpensesData?.topAccounts;
  const topRevenues = topRevenuesData?.topAccounts;
  const isLoading =
    isLoadingSummary || isLoadingAgingC || isLoadingAgingS || isLoadingTopE || isLoadingTopR;

  if (!exerciseId) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-sm font-medium text-ink">Sélectionnez un exercice</p>
        <p className="text-xs text-ink-mute">
          Choisissez un exercice pour consulter l'analyse financière détaillée.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-ink-mute">
        <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.5} />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-ink-mute">
        Impossible de charger les données de l'analyse financière.
      </div>
    );
  }

  const formatter = new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: summary.currency || 'XOF',
    maximumFractionDigits: 0,
  });

  const grossMarginVal = summary.grossMarginRatio !== null ? summary.grossMarginRatio * 100 : 0;
  const grossMargin =
    summary.grossMarginRatio !== null ? `${grossMarginVal.toFixed(1)} %` : 'N/A';
  const liquidityVal = summary.liquidityRatio !== null ? summary.liquidityRatio : 0;
  const liquidity = summary.liquidityRatio !== null ? liquidityVal.toFixed(2) : 'N/A';

  const rev = parseFloat(summary.revenueYtd || '0');
  const exp = parseFloat(summary.expensesYtd || '0');
  const rec = parseFloat(summary.receivables || '0');
  const pay = parseFloat(summary.payables || '0');
  const dso = rev > 0 ? Math.round((rec / rev) * 365) : 0;
  const dpo = exp > 0 ? Math.round((pay / exp) * 365) : 0;

  let compGrossMargin = 0, compLiquidity = 0, compDso = 0, compDpo = 0;
  if (compSummary) {
    compGrossMargin =
      compSummary.grossMarginRatio !== null ? compSummary.grossMarginRatio * 100 : 0;
    compLiquidity = compSummary.liquidityRatio !== null ? compSummary.liquidityRatio : 0;
    const cRev = parseFloat(compSummary.revenueYtd || '0');
    const cExp = parseFloat(compSummary.expensesYtd || '0');
    const cRec = parseFloat(compSummary.receivables || '0');
    const cPay = parseFloat(compSummary.payables || '0');
    compDso = cRev > 0 ? Math.round((cRec / cRev) * 365) : 0;
    compDpo = cExp > 0 ? Math.round((cPay / cExp) * 365) : 0;
  }

  function getTrend(
    current: number,
    previous: number | null,
    isPercentage = false,
  ): { text: string; isUp: boolean } {
    if (!compSummary || previous === null) return { text: 'N/A', isUp: true };
    const diff = current - previous;
    if (Math.abs(diff) < 0.01) return { text: '0 %', isUp: true };
    if (isPercentage) {
      return { text: `${diff > 0 ? '+' : ''}${diff.toFixed(1)} pts`, isUp: diff >= 0 };
    }
    const pct = previous !== 0 ? (diff / Math.abs(previous)) * 100 : 100;
    return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(1)} %`, isUp: diff >= 0 };
  }

  const trendGrossMargin = getTrend(grossMarginVal, compSummary ? compGrossMargin : null, true);
  const trendLiquidity = getTrend(liquidityVal, compSummary ? compLiquidity : null);
  const trendDso = getTrend(dso, compSummary ? compDso : null);
  const trendDpo = getTrend(dpo, compSummary ? compDpo : null);
  const compLabel =
    compExerciseId
      ? (rootPeriods.find((p) => p.id === compExerciseId)?.label ?? 'N-1')
      : 'mois prec.';

  const agingChartData = [
    {
      name: '0-30 j',
      clients: parseFloat(agingClients?.buckets.find((b: any) => b.bucket === '0-30')?.amount || '0'),
      fournisseurs: parseFloat(agingSuppliers?.buckets.find((b: any) => b.bucket === '0-30')?.amount || '0'),
    },
    {
      name: '31-60 j',
      clients: parseFloat(agingClients?.buckets.find((b: any) => b.bucket === '31-60')?.amount || '0'),
      fournisseurs: parseFloat(agingSuppliers?.buckets.find((b: any) => b.bucket === '31-60')?.amount || '0'),
    },
    {
      name: '61-90 j',
      clients: parseFloat(agingClients?.buckets.find((b: any) => b.bucket === '61-90')?.amount || '0'),
      fournisseurs: parseFloat(agingSuppliers?.buckets.find((b: any) => b.bucket === '61-90')?.amount || '0'),
    },
    {
      name: '> 90 j',
      clients: parseFloat(agingClients?.buckets.find((b: any) => b.bucket === 'over-90')?.amount || '0'),
      fournisseurs: parseFloat(agingSuppliers?.buckets.find((b: any) => b.bucket === 'over-90')?.amount || '0'),
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <p className="eyebrow mb-1">Vue finances</p>
        <h2 className="font-display text-xl font-medium text-ink">Analyse financière détaillée</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Marge brute"
          value={grossMargin}
          trend={trendGrossMargin.text}
          trendUp={trendGrossMargin.isUp}
          trendLabel={`vs ${compLabel}`}
          icon={Percent}
        />
        <KpiCard
          title="Ratio de liquidité"
          value={liquidity}
          trend={trendLiquidity.text}
          trendUp={trendLiquidity.isUp}
          trendLabel={`vs ${compLabel}`}
          subtitle={(summary.liquidityRatio || 0) < 1 ? 'Risque de trésorerie' : 'Couverture saine'}
          icon={Scale}
        />
        <KpiCard
          title="DSO — créances"
          value={`${dso} j`}
          trend={trendDso.text}
          trendUp={!trendDso.isUp}
          trendLabel={`vs ${compLabel}`}
          subtitle={dso > 60 ? 'Recouvrement lent' : 'Encaissement sain'}
          icon={TrendingDown}
        />
        <KpiCard
          title="DPO — dettes"
          value={`${dpo} j`}
          trend={trendDpo.text}
          trendUp={!trendDpo.isUp}
          trendLabel={`vs ${compLabel}`}
          subtitle={dpo > 90 ? 'Risque fournisseur' : 'Paiement normal'}
          icon={TrendingUp}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-paper p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="eyebrow mb-0.5">Créances clients / Dettes fournisseurs</p>
              <h3 className="font-display text-lg font-medium text-ink">Balance âgée</h3>
            </div>
            <Clock className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agingChartData} margin={{ top: 10, right: 0, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(var(--line))" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'oklch(var(--ink-mute))' }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'oklch(var(--ink-mute))' }}
                  tickFormatter={(val) =>
                    new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(val)
                  }
                />
                <Tooltip
                  formatter={(value: number | string | readonly (string | number)[] | undefined) => formatter.format(typeof value === 'number' ? value : 0)}
                  cursor={{ fill: 'oklch(var(--sunk))', opacity: 0.4 }}
                  contentStyle={{
                    borderRadius: '6px',
                    border: '1px solid oklch(var(--line))',
                    backgroundColor: 'oklch(var(--paper))',
                    fontSize: '12px',
                  }}
                />
                <Legend verticalAlign="top" height={32} iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="clients" name="Créances clients" fill="oklch(var(--accent))" radius={[3, 3, 0, 0]} maxBarSize={36} />
                <Bar dataKey="fournisseurs" name="Dettes fournisseurs" fill="oklch(var(--warn))" radius={[3, 3, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <TopAccountsTable
            title="Top 5 charges"
            rows={topExpenses?.rows}
            formatter={formatter}
            emptyText="Aucune charge enregistrée sur la période."
          />
          <TopAccountsTable
            title="Top 5 produits"
            rows={topRevenues?.rows}
            formatter={formatter}
            emptyText="Aucun produit enregistré sur la période."
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Top Accounts Table ─────────────────────────────────────── */

function TopAccountsTable({
  title,
  rows,
  formatter,
  emptyText,
}: {
  title: string;
  rows: any[] | undefined;
  formatter: Intl.NumberFormat;
  emptyText: string;
}) {
  return (
    <div className="flex-1 rounded-lg border border-line bg-paper p-5">
      <p className="eyebrow mb-3">{title}</p>
      <div className="space-y-3">
        {rows && rows.length > 0 ? (
          rows.map((row: any) => (
            <div key={row.accountId} className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="shrink-0 rounded-xs bg-sunk px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-soft">
                  {row.accountCode}
                </span>
                <span className="truncate text-sm font-medium text-ink" title={row.accountLabel}>
                  {row.accountLabel}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="num text-sm font-medium text-ink">
                  {formatter.format(row.amount)}
                </span>
                <span className="w-10 text-right text-xs tabular-nums text-ink-mute">
                  {row.sharePercent}%
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="py-2 text-sm text-ink-mute">{emptyText}</p>
        )}
      </div>
    </div>
  );
}
