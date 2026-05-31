'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  CalendarCheck,
  FileUp,
  Link2,
  PenLine,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/* ─── Types (subset of the dashboard day-summary) ─────────────── */

interface PendingCounts {
  entries: number;
  bankLines: number;
  auxLettering: number;
  tvaDeclarations: number;
}

export interface AccueilSummary {
  pending: PendingCounts;
  exercise: { label: string } | null;
  activePeriod: { label: string; endDate: string } | null;
  entriesThisMonth: number;
  score: { value: number; grade: string } | null;
}

interface AccueilBentoProps {
  readonly orgId: string;
  readonly exerciseId: string;
  readonly userName: string;
  readonly orgName: string;
  readonly summary?: AccueilSummary;
  readonly isLoading: boolean;
  readonly greeting: string;
  readonly dateLabel: string;
}

interface CashTrend {
  points: ReadonlyArray<{ yearMonth: string; netCash: string }>;
  currentNetCash: string;
}

/* ─── Helpers ─────────────────────────────────────────────────── */

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (abs >= 1_000) return `${(value / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value);
}

function scoreTone(value: number): { stroke: string; text: string; word: string } {
  if (value >= 80) return { stroke: 'oklch(var(--accent))', text: 'text-accent-ink', word: 'Très bon' };
  if (value >= 60) return { stroke: 'oklch(var(--warn))', text: 'text-warn-ink', word: 'Correct' };
  return { stroke: 'oklch(var(--critical))', text: 'text-critical-ink', word: 'À surveiller' };
}

function monthRange(): { fromMonth: string; toMonth: string } {
  const ym = (back: number): string => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - back);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  return { fromMonth: ym(5), toMonth: ym(0) };
}

/* ─── Component ────────────────────────────────────────────────── */

export function AccueilBento({
  orgId,
  userName,
  orgName,
  summary,
  isLoading,
  greeting,
  dateLabel,
}: AccueilBentoProps) {
  const range = useMemo(() => monthRange(), []);
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

  const notConfigured = !isLoading && !summary?.exercise;
  const pending = summary?.pending;
  const pendingTotal = pending
    ? pending.entries + pending.bankLines + pending.auxLettering + pending.tvaDeclarations
    : 0;

  const series = (trendQuery.data?.points ?? []).map((p) => Number(p.netCash));
  const cash = trendQuery.data?.currentNetCash != null ? Number(trendQuery.data.currentNetCash) : null;
  const cashTrendPct =
    series.length >= 2 && series[0] !== 0
      ? ((series[series.length - 1]! - series[0]!) / Math.abs(series[0]!)) * 100
      : null;

  return (
    <section aria-label="Accueil" className="space-y-7">
      {/* Greeting — warm but compact, the instruments carry the page */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-display text-3xl leading-none text-ink">
          {greeting} {userName}
        </h1>
        <p className="text-sm text-ink-mute">{dateLabel}</p>
      </div>

      {notConfigured ? (
        <WelcomeSetup />
      ) : (
        <>
          <p className="-mt-3 text-sm text-ink-soft">
            Voici l’état de <span className="font-medium text-ink">{orgName}</span> en un coup d’œil.
          </p>

          {/* Instrument panel — four distinct visual instruments */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {/* 1. Santé — full ring */}
            <Instrument label="Santé du dossier">
              <ScoreRing value={summary?.score?.value ?? null} loading={isLoading} />
              <Caption>
                {summary?.score ? scoreTone(summary.score.value).word : 'En attente d’écritures'}
              </Caption>
            </Instrument>

            {/* 2. Trésorerie — real sparkline */}
            <Instrument label="Trésorerie">
              <div className="flex h-[88px] w-full flex-col justify-center">
                <div className="flex items-baseline gap-2">
                  <span className="num text-2xl font-semibold tabular-nums text-ink">
                    {trendQuery.isLoading ? '···' : cash != null ? formatCompact(cash) : '—'}
                  </span>
                  {cashTrendPct != null && (
                    <span
                      className={cn(
                        'inline-flex items-center text-xs font-medium',
                        cashTrendPct >= 0 ? 'text-accent-ink' : 'text-critical-ink',
                      )}
                    >
                      {cashTrendPct >= 0 ? (
                        <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2} />
                      )}
                      {Math.abs(cashTrendPct).toFixed(0)} %
                    </span>
                  )}
                </div>
                <Sparkline values={series} positive={(cashTrendPct ?? 0) >= 0} />
              </div>
              <Caption>FCFA, 6 derniers mois</Caption>
            </Instrument>

            {/* 3. À traiter — segmented pastille */}
            <Instrument label="À traiter">
              <div className="flex h-[88px] flex-col items-center justify-center">
                <span
                  className={cn(
                    'num text-4xl font-semibold tabular-nums',
                    pendingTotal > 0 ? 'text-warn-ink' : 'text-accent-ink',
                  )}
                >
                  {pendingTotal}
                </span>
              </div>
              <div className="mt-1 flex w-full justify-center gap-3">
                <Segment href="/entry-workflow" label="Écr." count={pending?.entries ?? 0} />
                <Segment href="/bank-reconciliation" label="Banq." count={pending?.bankLines ?? 0} />
                <Segment href="/lettering" label="Lettr." count={pending?.auxLettering ?? 0} />
                <Segment href="/tva" label="TVA" count={pending?.tvaDeclarations ?? 0} />
              </div>
            </Instrument>

            {/* 4. Période — semicircle progress arc */}
            <Instrument label="Période">
              <PeriodArc endDate={summary?.activePeriod?.endDate ?? null} />
              <Caption>
                <span className="font-medium text-ink">{summary?.activePeriod?.label ?? '—'}</span>
                {summary?.activePeriod ? ' ouverte' : ''}
              </Caption>
            </Instrument>
          </div>

          {/* Action launchers */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ActionTile href="/journals" icon={PenLine} label="Saisir" hint="Nouvelle écriture" />
            <ActionTile href="/reports" icon={BarChart3} label="États" hint="Bilan, résultat" />
            <ActionTile href="/lettering" icon={Link2} label="Lettrer" hint="Tiers 40x / 41x" />
            <ActionTile href="/imports" icon={FileUp} label="Importer" hint="Sage, CSV, PDF" />
          </div>
        </>
      )}
    </section>
  );
}

/* ─── Instrument frame + caption ──────────────────────────────── */

function Instrument({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-line bg-paper p-5 text-center">
      <p className="eyebrow mb-3">{label}</p>
      {children}
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs text-ink-mute">{children}</p>;
}

/* ─── Instrument 1 — score ring ───────────────────────────────── */

function ScoreRing({ value, loading }: { value: number | null; loading: boolean }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const pct = value != null ? Math.max(0, Math.min(100, value)) / 100 : 0;
  const stroke = value != null ? scoreTone(value).stroke : 'oklch(var(--line-strong))';

  return (
    <div className="relative h-[88px] w-[88px]">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="oklch(var(--sunk))" strokeWidth="8" />
        {value != null && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={stroke}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="num text-2xl font-semibold tabular-nums text-ink">
          {loading ? '··' : value != null ? value : '—'}
        </span>
      </div>
    </div>
  );
}

/* ─── Instrument 2 — sparkline ────────────────────────────────── */

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) {
    return <div className="mt-2 h-9 w-full rounded-sm bg-sunk/50" aria-hidden />;
  }
  const w = 120;
  const h = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  const color = positive ? 'oklch(var(--accent))' : 'oklch(var(--critical))';

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-9 w-full" preserveAspectRatio="none">
      <path d={area} fill={color} fillOpacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ─── Instrument 3 — pending segment ──────────────────────────── */

function Segment({ href, label, count }: { href: string; label: string; count: number }) {
  const active = count > 0;
  return (
    <Link href={href} className="group flex flex-col items-center gap-1" title={`${count} ${label}`}>
      <span
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full text-2xs font-semibold tabular-nums',
          active ? 'bg-warn-soft text-warn-ink' : 'bg-sunk text-ink-mute',
        )}
      >
        {count}
      </span>
      <span className="text-[10px] text-ink-mute group-hover:text-ink-soft">{label}</span>
    </Link>
  );
}

/* ─── Instrument 4 — period arc ───────────────────────────────── */

function PeriodArc({ endDate }: { endDate: string | null }) {
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const frac = Math.max(0, Math.min(1, now.getDate() / daysInMonth));

  const remaining = endDate
    ? Math.max(0, Math.ceil((new Date(endDate).getTime() - now.getTime()) / 86_400_000))
    : null;

  // Semicircle: radius 38, from (7,45) to (83,45)
  const len = Math.PI * 38;

  return (
    <div className="relative flex h-[88px] w-full items-end justify-center">
      <svg viewBox="0 0 90 50" className="h-[72px] w-[120px]">
        <path
          d="M7,45 A38,38 0 0 1 83,45"
          fill="none"
          stroke="oklch(var(--sunk))"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M7,45 A38,38 0 0 1 83,45"
          fill="none"
          stroke="oklch(var(--accent))"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={len}
          strokeDashoffset={len * (1 - frac)}
        />
      </svg>
      <div className="absolute bottom-1 flex flex-col items-center">
        <span className="num text-lg font-semibold tabular-nums text-ink">
          {remaining != null ? `J-${remaining}` : '—'}
        </span>
        <span className="text-[10px] text-ink-mute">avant clôture</span>
      </div>
    </div>
  );
}

/* ─── Action launchers + welcome ──────────────────────────────── */

function ActionTile({
  href,
  icon: Icon,
  label,
  hint,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-lg border border-line bg-paper p-5 transition-colors duration-fast hover:border-line-strong hover:bg-sunk/40"
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-accent-ink transition-transform duration-base group-hover:-translate-y-0.5">
        <Icon className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <span className="mt-1 text-sm font-semibold text-ink">{label}</span>
      <span className="text-xs text-ink-mute">{hint}</span>
    </Link>
  );
}

function WelcomeSetup() {
  return (
    <div className="rounded-lg border border-line bg-paper p-8 text-center">
      <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl border border-accent/15 bg-accent-soft text-accent-ink">
        <CalendarCheck className="h-6 w-6" strokeWidth={1.5} />
      </span>
      <h2 className="mt-5 text-lg font-semibold text-ink">Configurons votre dossier</h2>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-sm leading-relaxed text-ink-soft">
        Ouvrez votre premier exercice comptable : c’est l’étape qui débloque la saisie, les états
        et le suivi de votre dossier.
      </p>
      <Link
        href="/accounting-periods"
        className="mt-5 inline-flex items-center gap-2 rounded-sm bg-accent px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-accent/90"
      >
        Ouvrir un exercice <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
      </Link>
    </div>
  );
}
