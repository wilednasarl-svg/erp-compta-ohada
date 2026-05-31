'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  BarChart3,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  FileText,
  FileUp,
  Link2,
  Minus,
  PenLine,
  Percent,
  RotateCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/* ─── Types ───────────────────────────────────────────────────── */

interface PendingCounts {
  readonly entries: number;
  readonly bankLines: number;
  readonly auxLettering: number;
  readonly tvaDeclarations: number;
}

interface ActivityEvent {
  readonly module: string;
  readonly action: string;
  readonly entityType: string | null;
  readonly createdAt: string;
}

/**
 * Forme minimale consommée par l'accueil. Structurellement compatible avec le
 * `DaySummary` renvoyé par `/dashboards/day-summary` (champs en plus tolérés).
 */
export interface AccueilSummary {
  readonly pending: PendingCounts;
  readonly exercise: { readonly label: string; readonly endDate?: string } | null;
  readonly activePeriod: { readonly label: string; readonly endDate: string } | null;
  readonly entriesThisMonth: number;
  readonly pendingThisMonth?: number;
  readonly score: { readonly value: number; readonly grade: string } | null;
  readonly recentActivity?: ReadonlyArray<ActivityEvent>;
}

interface AccueilBentoProps {
  readonly orgId: string;
  readonly exerciseId: string;
  readonly userName: string;
  readonly orgName: string;
  readonly summary?: AccueilSummary;
  readonly isLoading: boolean;
  readonly isError?: boolean;
  readonly onRetry?: () => void;
  readonly greeting: string;
  readonly dateLabel: string;
}

interface CashTrend {
  readonly points: ReadonlyArray<{ readonly yearMonth: string; readonly netCash: string }>;
  readonly currentNetCash: string;
}

type Trend = 'up' | 'flat' | 'down';

/* ─── Formatters & métier ─────────────────────────────────────── */

const FCFA = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

function fmtInt(n: number): string {
  return FCFA.format(n);
}

function formatFcfa(value: number): string {
  return `${FCFA.format(value)} FCFA`;
}

function monthShort(yearMonth: string): string {
  const [y, m] = yearMonth.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'short' });
}

/** Libellé qualitatif du score (les 5 paliers métier du dossier). */
function scoreLabel(value: number): string {
  if (value >= 85) return 'Très bon';
  if (value >= 70) return 'Bon';
  if (value >= 55) return 'Correct';
  if (value >= 40) return 'À surveiller';
  return 'Critique';
}

function scoreTone(value: number): { stroke: string; text: string } {
  if (value >= 70) return { stroke: 'oklch(var(--accent))', text: 'text-accent-ink' };
  if (value >= 50) return { stroke: 'oklch(var(--warn))', text: 'text-warn-ink' };
  return { stroke: 'oklch(var(--critical))', text: 'text-critical-ink' };
}

function classifyTrend(pct: number | null): Trend {
  if (pct === null || Math.abs(pct) < 2) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

function actionLabel(event: ActivityEvent): string {
  const labels: Record<string, string> = {
    'journal_entries.create': 'écriture créée',
    'journal_entries.validate': 'écriture validée',
    'journal_entries.cancel': 'écriture annulée',
    'imports.create': 'import démarré',
    'imports.commit': 'import validé',
    'tva.calculate': 'déclaration TVA calculée',
    'bank_reconciliation.match': 'rapprochement effectué',
    'lettering.apply': 'lettrage appliqué',
    'accounting_periods.close': 'période clôturée',
  };
  return labels[`${event.module}.${event.action}`] ?? event.action.replace(/_/g, ' ');
}

function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

function daysUntil(iso: string | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/* ─── Composant principal ─────────────────────────────────────── */

export function AccueilBento({
  orgId,
  userName,
  orgName,
  summary,
  isLoading,
  isError,
  onRetry,
  greeting,
  dateLabel,
}: AccueilBentoProps) {
  const range = useMemo(() => {
    const ym = (back: number): string => {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - back);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };
    return { fromMonth: ym(5), toMonth: ym(0) };
  }, []);

  const trendQuery = useQuery<CashTrend, ApiError>({
    queryKey: ['accueil-cash-trend', orgId, range.fromMonth, range.toMonth],
    queryFn: async () => {
      const data = await api.get<{ report: CashTrend }>(
        `/organizations/${orgId}/reports/cash-trend?fromMonth=${range.fromMonth}&toMonth=${range.toMonth}`,
      );
      return data.report;
    },
    enabled: orgId !== '',
    staleTime: 60_000,
  });

  const notConfigured = !isLoading && !isError && !summary?.exercise;
  const pending = summary?.pending;

  const series = (trendQuery.data?.points ?? []).map((p) => ({
    month: monthShort(p.yearMonth),
    cash: Number(p.netCash),
  }));
  const cash = trendQuery.data?.currentNetCash != null ? Number(trendQuery.data.currentNetCash) : null;
  const cashPct =
    series.length >= 2 && series[0]!.cash !== 0
      ? ((series[series.length - 1]!.cash - series[0]!.cash) / Math.abs(series[0]!.cash)) * 100
      : null;
  const trend = classifyTrend(cashPct);

  const exerciseDays = daysUntil(summary?.exercise?.endDate);
  const periodDays = daysUntil(summary?.activePeriod?.endDate);

  // Initialisation : le dossier a-t-il déjà ses premières écritures ?
  const hasEntries =
    (summary?.entriesThisMonth ?? 0) > 0 ||
    (summary?.pending.entries ?? 0) > 0 ||
    (summary?.recentActivity ?? []).some((e) => e.module === 'journal_entries');
  // Dossier neuf : exercice ouvert mais encore vide (aucun score calculé).
  const isFreshDossier = !isLoading && !!summary?.exercise && !hasEntries && summary?.score == null;

  /* ── État : erreur de chargement du dossier ── */
  if (isError) {
    return (
      <section aria-label="Accueil" className="space-y-8">
        <DossierHero greeting={greeting} userName={userName} dateLabel={dateLabel} orgName={orgName} isLoading={false} score={null} />
        <div className="rounded-md border border-line bg-paper px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">Impossible de charger les données du dossier.</p>
          <p className="mx-auto mt-1 max-w-[44ch] text-xs text-ink-mute">
            La connexion au serveur a échoué. Vérifiez votre réseau, puis réessayez.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="press mt-5 inline-flex items-center gap-2 rounded-sm border border-line-strong bg-canvas px-4 py-2 text-sm font-medium text-ink transition-colors duration-fast hover:bg-sunk"
            >
              <RotateCw className="h-4 w-4" strokeWidth={1.5} />
              Réessayer
            </button>
          )}
        </div>
      </section>
    );
  }

  const exUrgent = exerciseDays != null && exerciseDays <= 15;

  return (
    <section aria-label="Accueil" className="space-y-8">
      <DossierHero
        greeting={greeting}
        userName={userName}
        dateLabel={dateLabel}
        orgName={orgName}
        isLoading={isLoading}
        score={summary?.score ?? null}
      />

      {notConfigured ? (
        <SetupGuide hasExercise={false} hasEntries={hasEntries} />
      ) : (
        <>
          {/* ── Initialisation guidée (dossier neuf) OU priorité du moment ── */}
          {isFreshDossier ? (
            <SetupGuide hasExercise hasEntries={false} compact />
          ) : (
            <PriorityFocus isLoading={isLoading} priority={computePriority(pending, exerciseDays, cashPct)} />
          )}

          {/* ── Bande d'état secondaire (filets, pas de cartes) ── */}
          <div className="grid divide-y divide-line border-y border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <StatCell
              position="first"
              isLoading={isLoading}
              icon={CalendarClock}
              tone={exUrgent ? 'warn' : 'neutral'}
              eyebrow="Exercice"
              value={summary?.exercise?.label ?? '—'}
              sub={exerciseDays != null ? `clôture dans ${exerciseDays} j` : 'ouvert'}
            />
            <StatCell
              position="mid"
              isLoading={isLoading}
              icon={FileText}
              eyebrow="Écritures du mois"
              mono
              value={fmtInt(summary?.entriesThisMonth ?? 0)}
              sub={
                summary?.pendingThisMonth
                  ? `dont ${fmtInt(summary.pendingThisMonth)} en attente`
                  : 'à jour'
              }
            />
            <StatCell
              position="last"
              isLoading={isLoading}
              icon={CalendarDays}
              eyebrow="Période active"
              value={summary?.activePeriod?.label ?? '—'}
              sub={periodDays != null ? `clôture dans ${periodDays} j` : 'ouverte'}
            />
          </div>

          {/* ── Priorités + trésorerie ── */}
          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <TaskSection isLoading={isLoading} pending={pending} />
            <TreasuryPanel
              isLoading={trendQuery.isLoading}
              isError={trendQuery.isError}
              onRetry={() => trendQuery.refetch()}
              series={series}
              cash={cash}
              pct={cashPct}
              trend={trend}
            />
          </div>

          {/* ── Lanceurs d'action ── */}
          <section aria-labelledby="actions-title">
            <h2 id="actions-title" className="eyebrow mb-3">
              Que voulez-vous faire ?
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ActionTile href="/journals" icon={PenLine} label="Saisir" hint="Nouvelle écriture" />
              <ActionTile href="/reports" icon={BarChart3} label="Voir les états" hint="Bilan, résultat, DSF" />
              <ActionTile href="/lettering" icon={Link2} label="Lettrer" hint="Tiers 40x / 41x" />
              <ActionTile href="/imports" icon={FileUp} label="Importer" hint="Sage, CSV, PDF" />
            </div>
          </section>

          {/* ── Activité récente ── */}
          <RecentActivity isLoading={isLoading} events={summary?.recentActivity ?? []} />
        </>
      )}
    </section>
  );
}

/* ─── Hero éditorial : salutation + score focal ───────────────── */

function DossierHero({
  greeting,
  userName,
  dateLabel,
  orgName,
  isLoading,
  score,
}: {
  greeting: string;
  userName: string;
  dateLabel: string;
  orgName: string;
  isLoading: boolean;
  score: { value: number; grade: string } | null;
}) {
  return (
    <header className="flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="eyebrow">{dateLabel}</p>
        <h1 className="mt-2 font-display text-4xl leading-[1.05] sm:text-[2.75rem]">
          {greeting} {userName}
        </h1>
        <p className="mt-3 max-w-[48ch] text-base text-ink-soft">
          Content de vous revoir. Voici l&apos;essentiel de{' '}
          <span className="font-medium text-ink">{orgName}</span> aujourd&apos;hui.
        </p>
      </div>
      {/* Score affiché seulement s'il existe (ou en chargement) : sinon le hero
          reste pleine largeur, pour un démarrage net sur dossier neuf. */}
      {(isLoading || score) && <HeroScore isLoading={isLoading} score={score} />}
    </header>
  );
}

function HeroScore({ isLoading, score }: { isLoading: boolean; score: { value: number; grade: string } | null }) {
  if (isLoading) {
    return (
      <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:gap-3" aria-hidden>
        <div className="h-28 w-28 animate-pulse rounded-full bg-sunk" />
        <div className="h-4 w-24 animate-pulse rounded-xs bg-sunk" />
      </div>
    );
  }

  if (!score) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2 text-center">
        <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-ink-mute">
          <Minus className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <p className="text-xs text-ink-mute">Score à venir</p>
      </div>
    );
  }

  const { text } = scoreTone(score.value);
  return (
    <div className="flex shrink-0 items-center gap-5 sm:flex-col sm:gap-3">
      <HeroScoreRing value={score.value} />
      <Link href="/accounting-score" className="group sm:text-center">
        <p className={cn('font-display text-xl leading-none', text)}>{scoreLabel(score.value)}</p>
        <p className="eyebrow mt-1.5 inline-flex items-center gap-1 transition-colors duration-fast group-hover:text-ink-soft">
          Santé du dossier
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
        </p>
      </Link>
    </div>
  );
}

function HeroScoreRing({ value }: { value: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - value / 100);
  const { stroke, text } = scoreTone(value);

  return (
    <div
      className="relative flex h-28 w-28 shrink-0 items-center justify-center"
      role="img"
      aria-label={`Score de santé ${value} sur 100, ${scoreLabel(value)}`}
    >
      <svg width="112" height="112" viewBox="0 0 112 112" fill="none" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="56" cy="56" r={r} stroke="oklch(var(--line-strong))" strokeWidth="6" />
        <circle
          cx="56"
          cy="56"
          r={r}
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1000ms var(--ease-out-quint)' }}
        />
      </svg>
      <div className="text-center">
        <span className={cn('block font-display text-3xl leading-none tabular-nums', text)}>{value}</span>
        <span className="mt-1 block text-2xs uppercase tracking-wider text-ink-mute">/ 100</span>
      </div>
    </div>
  );
}

/* ─── Priorité intelligente du moment ─────────────────────────── */

interface Priority {
  readonly tone: 'critical' | 'warn' | 'info';
  readonly icon: LucideIcon;
  readonly title: string;
  readonly why: string;
  readonly href: string;
  readonly cta: string;
}

/**
 * Désigne LA chose la plus importante à faire maintenant, à partir des données
 * réelles du dossier. Ordre métier : échéance fiscale > clôture imminente >
 * écritures bloquantes > risque de trésorerie > hygiène (lettrage, banque).
 * Renvoie null quand le dossier est à jour.
 */
function computePriority(
  pending: PendingCounts | undefined,
  exerciseDays: number | null,
  cashPct: number | null,
): Priority | null {
  if (!pending) return null;

  if (pending.tvaDeclarations > 0) {
    const n = pending.tvaDeclarations;
    return {
      tone: 'critical',
      icon: Percent,
      title: `${n} déclaration${n > 1 ? 's' : ''} TVA à finaliser`,
      why: 'Le dépôt DGI est soumis à échéance : à traiter avant le reste.',
      href: '/tva',
      cta: 'Ouvrir la TVA',
    };
  }

  if (exerciseDays != null && exerciseDays <= 7) {
    return {
      tone: 'warn',
      icon: CalendarClock,
      title: exerciseDays === 0 ? "Clôture de l'exercice aujourd'hui" : `Clôture de l'exercice dans ${exerciseDays} j`,
      why: 'Vérifiez les écritures et les états financiers avant de clôturer.',
      href: '/accounting-periods',
      cta: 'Préparer la clôture',
    };
  }

  if (pending.entries > 0) {
    const n = pending.entries;
    return {
      tone: 'warn',
      icon: PenLine,
      title: `${n} écriture${n > 1 ? 's' : ''} à valider`,
      why: 'En brouillon, elles ne remontent ni dans les états ni dans le lettrage.',
      href: '/entry-workflow',
      cta: 'Valider',
    };
  }

  if (cashPct != null && cashPct <= -10) {
    return {
      tone: 'info',
      icon: TrendingDown,
      title: `Trésorerie en baisse de ${Math.abs(Math.round(cashPct))} % sur 6 mois`,
      why: 'Surveillez les encaissements clients et le besoin en fonds de roulement.',
      href: '/dashboards/treasury',
      cta: 'Analyser',
    };
  }

  if (pending.auxLettering > 0) {
    const n = pending.auxLettering;
    return {
      tone: 'info',
      icon: Link2,
      title: `${n} lettrage${n > 1 ? 's' : ''} à rapprocher`,
      why: 'Le lettrage fiabilise les soldes auxiliaires 40x / 41x.',
      href: '/lettering',
      cta: 'Lettrer',
    };
  }

  if (pending.bankLines > 0) {
    const n = pending.bankLines;
    return {
      tone: 'info',
      icon: Banknote,
      title: `${n} ligne${n > 1 ? 's' : ''} bancaire${n > 1 ? 's' : ''} à pointer`,
      why: 'Le rapprochement garantit la cohérence avec le relevé bancaire.',
      href: '/bank-reconciliation',
      cta: 'Pointer',
    };
  }

  return null;
}

function PriorityFocus({ isLoading, priority }: { isLoading: boolean; priority: Priority | null }) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-4 rounded-md border border-line bg-paper p-4" aria-hidden>
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-sunk" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/5 animate-pulse rounded-xs bg-sunk" />
          <div className="h-3 w-3/5 animate-pulse rounded-xs bg-sunk" />
        </div>
      </div>
    );
  }

  if (!priority) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-line bg-paper px-4 py-3.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
          <CheckCircle2 className="h-5 w-5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">Tout est à jour, rien d&apos;urgent aujourd&apos;hui.</p>
          <p className="text-xs text-ink-mute">Vous pouvez avancer sereinement sur le reste.</p>
        </div>
      </div>
    );
  }

  const Icon = priority.icon;
  const iconWrap = {
    critical: 'bg-critical-soft text-critical-ink',
    warn: 'bg-warn-soft text-warn-ink',
    info: 'bg-info-soft text-info-ink',
  }[priority.tone];
  const ctaPrimary = priority.tone !== 'info';

  return (
    <section
      aria-labelledby="priority-title"
      className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4 sm:flex-row sm:items-center"
    >
      <span className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full', iconWrap)}>
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p id="priority-title" className="eyebrow">
          À faire en priorité
        </p>
        <p className="mt-0.5 text-sm font-medium text-ink">{priority.title}</p>
        <p className="mt-0.5 text-xs text-ink-mute">{priority.why}</p>
      </div>
      <Link
        href={priority.href}
        className={cn(
          'press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm px-3.5 py-2 text-sm font-medium transition-colors duration-fast',
          ctaPrimary
            ? 'bg-accent text-[oklch(98%_0.004_85)] hover:opacity-90'
            : 'border border-line-strong bg-canvas text-ink hover:bg-sunk',
        )}
      >
        {priority.cta}
        <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
      </Link>
    </section>
  );
}

/* ─── Cellule de la bande d'état ──────────────────────────────── */

function StatCell({
  icon: Icon,
  tone = 'neutral',
  eyebrow,
  value,
  sub,
  mono = false,
  isLoading = false,
  position,
}: {
  icon: LucideIcon;
  tone?: 'neutral' | 'warn';
  eyebrow: string;
  value: string;
  sub?: string;
  mono?: boolean;
  isLoading?: boolean;
  position: 'first' | 'mid' | 'last';
}) {
  const pad = position === 'first' ? 'sm:pr-6' : position === 'last' ? 'sm:pl-6' : 'sm:px-6';
  return (
    <div className={cn('flex items-center gap-4 py-5', pad)}>
      <span
        className={cn(
          'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
          tone === 'warn' ? 'bg-warn-soft text-warn-ink' : 'bg-sunk text-ink-soft',
        )}
      >
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        {isLoading ? (
          <div className="mt-1.5 h-5 w-24 animate-pulse rounded-xs bg-sunk" />
        ) : (
          <>
            <p
              className={cn(
                'mt-0.5 truncate',
                mono ? 'num text-xl font-medium tabular-nums text-ink' : 'font-display text-xl text-ink',
              )}
              title={value}
            >
              {value}
            </p>
            {sub && <p className="mt-0.5 text-xs text-ink-mute">{sub}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── À traiter ───────────────────────────────────────────────── */

function TaskSection({ isLoading, pending }: { isLoading: boolean; pending?: PendingCounts }) {
  const pendingTotal = pending
    ? pending.entries + pending.bankLines + pending.auxLettering + pending.tvaDeclarations
    : 0;

  return (
    <section aria-labelledby="todo-title">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="todo-title" className="eyebrow">
          À traiter
        </h2>
        <Link
          href="/entry-workflow"
          className="group inline-flex items-center gap-1 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
        >
          Workflow complet
          <ArrowUpRight
            className="h-3 w-3 transition-transform duration-fast group-hover:-translate-y-px group-hover:translate-x-px"
            strokeWidth={1.5}
          />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-px overflow-hidden rounded-md border border-line bg-paper" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <div className="h-8 w-8 animate-pulse rounded-full bg-sunk" />
              <div className="h-3.5 flex-1 animate-pulse rounded-xs bg-sunk" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {pendingTotal === 0 && (
            <p className="mb-3 inline-flex items-center gap-2 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink">
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
              Tout est à jour, bravo.
            </p>
          )}
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-paper">
            <TaskRow
              icon={PenLine}
              label="Écritures à valider"
              detail="Journaux en brouillon"
              cta="Valider"
              count={pending?.entries ?? 0}
              href="/entry-workflow"
              tone="warn"
            />
            <TaskRow
              icon={Banknote}
              label="Lignes bancaires à pointer"
              detail="Relevés non rapprochés"
              cta="Pointer"
              count={pending?.bankLines ?? 0}
              href="/bank-reconciliation"
              tone="info"
            />
            <TaskRow
              icon={Link2}
              label="Lettrages à rapprocher"
              detail="Comptes 40x / 41x non lettrés"
              cta="Lettrer"
              count={pending?.auxLettering ?? 0}
              href="/lettering"
              tone="info"
            />
            <TaskRow
              icon={Percent}
              label="Déclarations TVA en attente"
              detail="Dépôt DGI à finaliser"
              cta="Finaliser"
              count={pending?.tvaDeclarations ?? 0}
              href="/tva"
              tone={(pending?.tvaDeclarations ?? 0) > 0 ? 'critical' : 'info'}
            />
          </ul>
        </>
      )}
    </section>
  );
}

function TaskRow({
  icon: Icon,
  label,
  detail,
  cta,
  count,
  href,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  cta: string;
  count: number;
  href: string;
  tone: 'info' | 'warn' | 'critical';
}) {
  const done = count === 0;
  const toneText = { info: 'text-info-ink', warn: 'text-warn-ink', critical: 'text-critical-ink' }[tone];

  return (
    <li>
      <Link
        href={href}
        className="press group flex items-center gap-4 px-4 py-3.5 transition-colors duration-fast hover:bg-sunk/60"
      >
        <span className="flex w-9 shrink-0 justify-center">
          {done ? (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft">
              <CheckCircle2 className="h-4 w-4 text-accent-ink" strokeWidth={1.5} />
            </span>
          ) : (
            <span className={cn('num text-2xl font-medium tabular-nums leading-none', toneText)}>{count}</span>
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.5} />
            <span className="text-sm font-medium text-ink">{label}</span>
          </span>
          <span className="mt-0.5 block text-xs text-ink-mute">{done ? 'Aucune action requise' : detail}</span>
        </span>

        {done ? (
          <span className="shrink-0 text-xs text-ink-mute">À jour</span>
        ) : (
          <span className="shrink-0 rounded-sm border border-line-strong bg-canvas px-2.5 py-1 text-xs font-medium text-ink opacity-0 transition-opacity duration-fast group-hover:opacity-100">
            {cta}
          </span>
        )}
      </Link>
    </li>
  );
}

/* ─── Trésorerie · 6 mois ─────────────────────────────────────── */

function TrendPill({ trend, pct }: { trend: Trend; pct: number | null }) {
  const Icon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const label = trend === 'up' ? 'en hausse' : trend === 'down' ? 'en baisse' : 'stable';
  const tone =
    trend === 'up' ? 'text-accent-ink' : trend === 'down' ? 'text-critical-ink' : 'text-ink-mute';
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', tone)}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {pct != null && trend !== 'flat' ? `${pct > 0 ? '+' : ''}${pct.toFixed(0)} % sur 6 mois` : label}
    </span>
  );
}

function TreasuryPanel({
  isLoading,
  isError,
  onRetry,
  series,
  cash,
  pct,
  trend,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  series: ReadonlyArray<{ month: string; cash: number }>;
  cash: number | null;
  pct: number | null;
  trend: Trend;
}) {
  return (
    <section aria-labelledby="cash-title" className="flex flex-col rounded-md border border-line bg-paper p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="cash-title" className="eyebrow inline-flex items-center gap-1.5">
            <Wallet className="h-3.5 w-3.5" strokeWidth={1.5} />
            Trésorerie · 6 mois
          </p>
          {cash != null ? (
            <p className="num mt-1 text-2xl font-medium tabular-nums text-ink">{formatFcfa(cash)}</p>
          ) : (
            <p className="mt-1 text-sm text-ink-mute">—</p>
          )}
        </div>
        {cash != null && <TrendPill trend={trend} pct={pct} />}
      </div>

      <div className="mt-4 h-40">
        {isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-xs text-ink-mute">Impossible de charger la trésorerie.</p>
            <button
              type="button"
              onClick={onRetry}
              className="press inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-canvas px-2.5 py-1 text-xs font-medium text-ink transition-colors duration-fast hover:bg-sunk"
            >
              <RotateCw className="h-3 w-3" strokeWidth={1.5} />
              Réessayer
            </button>
          </div>
        ) : isLoading ? (
          <div className="h-full w-full animate-pulse rounded-sm bg-sunk" aria-hidden />
        ) : series.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-ink-mute">Pas encore de mouvements de trésorerie.</p>
          </div>
        ) : (
          <>
            <span className="sr-only">
              Évolution de la trésorerie nette sur les six derniers mois, tendance{' '}
              {trend === 'up' ? 'à la hausse' : trend === 'down' ? 'à la baisse' : 'stable'}.
            </span>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series as { month: string; cash: number }[]} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="accueilCash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(var(--accent))" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="oklch(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: 'oklch(var(--ink-mute))' }}
                  dy={6}
                />
                <YAxis hide domain={['dataMin', 'dataMax']} />
                <Tooltip
                  cursor={{ stroke: 'oklch(var(--line-strong))', strokeWidth: 1 }}
                  formatter={(value: number | string | readonly (string | number)[] | undefined) => [
                    formatFcfa(typeof value === 'number' ? value : 0),
                    'Trésorerie',
                  ]}
                  contentStyle={{
                    borderRadius: '6px',
                    border: '1px solid oklch(var(--line))',
                    backgroundColor: 'oklch(var(--paper))',
                    boxShadow: '0 1px 2px oklch(18% 0.008 270 / 0.06), 0 8px 24px oklch(18% 0.008 270 / 0.08)',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: 'oklch(var(--ink-mute))' }}
                />
                <Area
                  type="monotone"
                  dataKey="cash"
                  stroke="oklch(var(--accent))"
                  strokeWidth={2}
                  fill="url(#accueilCash)"
                  fillOpacity={1}
                  dot={false}
                  activeDot={{ r: 3, fill: 'oklch(var(--accent))' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      <Link
        href="/dashboards/treasury"
        className="group mt-3 inline-flex items-center gap-1 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
      >
        Analyse de trésorerie
        <ArrowUpRight className="h-3 w-3 transition-transform duration-fast group-hover:-translate-y-px group-hover:translate-x-px" strokeWidth={1.5} />
      </Link>
    </section>
  );
}

/* ─── Lanceurs d'action ───────────────────────────────────────── */

function ActionTile({ href, icon: Icon, label, hint }: { href: string; icon: LucideIcon; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className="press group flex flex-col gap-3 rounded-md border border-line bg-paper p-4 transition-colors duration-fast hover:border-line-strong hover:bg-sunk/50"
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-sm bg-sunk text-ink-soft transition-colors duration-fast group-hover:bg-accent-soft group-hover:text-accent-ink">
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink-mute">{hint}</span>
      </span>
    </Link>
  );
}

/* ─── Activité récente ────────────────────────────────────────── */

function RecentActivity({ isLoading, events }: { isLoading: boolean; events: ReadonlyArray<ActivityEvent> }) {
  return (
    <section aria-labelledby="activity-title">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="activity-title" className="eyebrow">
          Derniers mouvements
        </h2>
        <Link
          href="/audit-logs"
          className="group inline-flex items-center gap-1 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
        >
          Journal d&apos;audit
          <ArrowUpRight className="h-3 w-3 transition-transform duration-fast group-hover:-translate-y-px group-hover:translate-x-px" strokeWidth={1.5} />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-2 w-2 animate-pulse rounded-full bg-sunk" />
              <div className="h-3.5 flex-1 animate-pulse rounded-xs bg-sunk" />
              <div className="h-3.5 w-16 animate-pulse rounded-xs bg-sunk" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <p className="rounded-md border border-line bg-paper px-4 py-6 text-center text-sm text-ink-mute">
          Aucune activité enregistrée. Les actions apparaîtront ici dès la première saisie.
        </p>
      ) : (
        <ol className="relative space-y-4">
          <span aria-hidden className="absolute bottom-[7px] left-[3.5px] top-[7px] w-px bg-line" />
          {events.slice(0, 5).map((event, i) => (
            <li key={i} className="relative flex items-baseline gap-3 pl-5">
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-[7px] h-2 w-2 rounded-full ring-2 ring-[oklch(var(--canvas))]',
                  `${event.module}.${event.action}`.match(/validate|commit|close|apply|match/)
                    ? 'bg-accent'
                    : `${event.module}.${event.action}`.includes('cancel')
                      ? 'bg-critical'
                      : 'bg-info',
                )}
              />
              <span className="flex-1 text-sm text-ink">
                <span className="mr-1.5 inline-block rounded-xs bg-sunk px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-soft">
                  {event.module}
                </span>
                {actionLabel(event)}
                {event.entityType && <span className="text-ink-mute"> · {event.entityType}</span>}
              </span>
              <span className="shrink-0 text-xs text-ink-mute">{relativeTime(event.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ─── Parcours d'initialisation (data-driven) ─────────────────── */

interface SetupStep {
  readonly label: string;
  readonly detail: string;
  readonly done: boolean;
  readonly href?: string;
  readonly cta?: string;
}

/**
 * Parcours d'initialisation, piloté par les vraies données du dossier.
 * Les étapes se cochent en temps réel (exercice ouvert → écritures saisies).
 * `compact` : variante bandeau quand le dossier a un exercice mais reste vide ;
 * variante pleine quand aucun exercice n'existe encore. L'étape courante est la
 * première non terminée et porte l'action.
 */
function SetupGuide({
  hasExercise,
  hasEntries,
  compact = false,
}: {
  hasExercise: boolean;
  hasEntries: boolean;
  compact?: boolean;
}) {
  const steps: ReadonlyArray<SetupStep> = [
    {
      label: 'Plan comptable SYSCOHADA',
      detail: 'Pré-chargé, prêt à l’emploi.',
      done: true,
    },
    {
      label: 'Ouvrir le premier exercice',
      detail: 'Définissez la période de départ et la date de clôture.',
      done: hasExercise,
      href: '/accounting-periods',
      cta: 'Ouvrir l’exercice',
    },
    {
      label: 'Saisir ou importer vos écritures',
      detail: 'Sage Saari, CSV, ou saisie manuelle pour démarrer le dossier.',
      done: hasEntries,
      href: '/imports',
      cta: 'Démarrer la saisie',
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <div className={cn('rounded-lg border border-line bg-paper', compact ? 'p-4 sm:p-5' : 'p-6 sm:p-8')}>
      {compact ? (
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Initialisation du dossier</p>
          <span className="num text-xs font-medium tabular-nums text-ink-mute">
            {doneCount} / {steps.length}
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
            <CalendarClock className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <p className="eyebrow">Premiers pas</p>
            <h2 className="mt-1 font-display text-2xl text-ink">Configurons votre dossier</h2>
            <p className="mt-1.5 max-w-[56ch] text-base leading-relaxed text-ink-soft">
              Voici par où commencer. L&apos;étape clé : ouvrir l&apos;exercice, qui débloque la saisie, les
              états financiers et le suivi du dossier.
            </p>
          </div>
        </div>
      )}

      <ol className={cn('space-y-1', compact ? 'mt-3' : 'mt-6')}>
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex;
          return (
            <li
              key={step.label}
              className={cn(
                'flex items-center gap-4 rounded-md px-3 py-3 transition-colors duration-fast',
                isCurrent && 'bg-sunk/60',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                  step.done
                    ? 'bg-accent-soft text-accent-ink'
                    : isCurrent
                      ? 'bg-accent text-[oklch(98%_0.004_85)]'
                      : 'border border-line-strong text-ink-mute',
                )}
              >
                {step.done ? <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-medium', step.done ? 'text-ink-soft' : 'text-ink')}>
                  {step.label}
                </p>
                <p className="mt-0.5 text-xs text-ink-mute">{step.detail}</p>
              </div>
              {isCurrent && step.href && step.cta ? (
                <Link
                  href={step.href}
                  className="press inline-flex shrink-0 items-center gap-1.5 rounded-sm bg-accent px-4 py-2 text-sm font-medium text-[oklch(98%_0.004_85)] transition-colors duration-fast hover:opacity-90"
                >
                  {step.cta}
                  <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
                </Link>
              ) : step.done ? (
                <span className="shrink-0 text-2xs uppercase tracking-wider text-accent-ink">Prêt</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
