'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  CalendarDays,
  FileUp,
  Gauge,
  Link2,
  ListChecks,
  PenLine,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';

import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/* ─── Types ───────────────────────────────────────────────────── */

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

function scoreWord(value: number): string {
  if (value >= 80) return 'Très bon';
  if (value >= 60) return 'Correct';
  return 'À surveiller';
}

const SOFT_SHADOW = 'shadow-[0_4px_20px_-6px_oklch(var(--ink)/0.10)]';

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

  const remaining = summary?.activePeriod?.endDate
    ? Math.max(0, Math.ceil((new Date(summary.activePeriod.endDate).getTime() - Date.now()) / 86_400_000))
    : null;

  return (
    <section aria-label="Accueil" className="space-y-6">
      {/* ── Warm greeting hero ── */}
      <div
        className={cn(
          'relative overflow-hidden rounded-3xl bg-[oklch(96.5%_0.028_88)] px-6 py-7 sm:px-8 sm:py-9',
          SOFT_SHADOW,
        )}
      >
        {/* soft decorative blobs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-12 h-44 w-44 rounded-full bg-[oklch(92%_0.06_155)] opacity-60 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-[oklch(93%_0.05_60)] opacity-50 blur-2xl"
        />
        <div className="relative">
          <p className="text-sm font-medium text-ink-mute">{dateLabel}</p>
          <h1 className="mt-1 font-display text-4xl leading-tight text-ink">
            {greeting} {userName}
          </h1>
          <p className="mt-2 max-w-[52ch] text-base text-ink-soft">
            Content de vous revoir. Voici l’essentiel de{' '}
            <span className="font-semibold text-ink">{orgName}</span> aujourd’hui.
          </p>
        </div>
      </div>

      {notConfigured ? (
        <WelcomeSetup />
      ) : (
        <>
          {/* ── Soft colourful stat tiles ── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              tint="96% 0.04 155"
              icon={Gauge}
              iconColor="text-accent-ink"
              value={isLoading ? '··' : summary?.score ? String(summary.score.value) : '—'}
              unit={summary?.score ? '/ 100' : undefined}
              label="Santé du dossier"
              sub={summary?.score ? scoreWord(summary.score.value) : 'Bientôt disponible'}
            />
            <StatTile
              tint="96% 0.032 235"
              icon={Wallet}
              iconColor="text-info-ink"
              value={trendQuery.isLoading ? '···' : cash != null ? formatCompact(cash) : '—'}
              unit={cash != null ? 'FCFA' : undefined}
              label="Trésorerie"
              trend={cashTrendPct}
            />
            <StatTile
              tint="96% 0.05 72"
              icon={ListChecks}
              iconColor="text-warn-ink"
              value={String(pendingTotal)}
              label="À faire"
              sub={pendingTotal > 0 ? 'éléments à traiter' : 'tout est à jour'}
              href="#a-faire"
            />
            <StatTile
              tint="96.5% 0.02 300"
              icon={CalendarDays}
              iconColor="text-ink"
              value={summary?.activePeriod?.label ?? '—'}
              valueSmall
              label="Période en cours"
              sub={remaining != null ? `clôture dans ${remaining} j` : 'ouverte'}
            />
          </div>

          {/* ── À faire — friendly task list ── */}
          {pendingTotal > 0 && (
            <div id="a-faire" className={cn('rounded-2xl border border-line bg-paper p-5', SOFT_SHADOW)}>
              <h2 className="mb-3 text-sm font-semibold text-ink">Ce qui vous attend</h2>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <TaskRow href="/entry-workflow" label="écritures à valider" count={pending?.entries ?? 0} />
                <TaskRow href="/bank-reconciliation" label="lignes bancaires à pointer" count={pending?.bankLines ?? 0} />
                <TaskRow href="/lettering" label="lettrages à rapprocher" count={pending?.auxLettering ?? 0} />
                <TaskRow href="/tva" label="déclarations TVA" count={pending?.tvaDeclarations ?? 0} />
              </div>
            </div>
          )}

          {/* ── Action launchers ── */}
          <div>
            <h2 className="mb-3 text-sm font-semibold text-ink">Que voulez-vous faire ?</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ActionTile href="/journals" icon={PenLine} label="Saisir" hint="Nouvelle écriture" tint="96% 0.04 155" iconColor="text-accent-ink" />
              <ActionTile href="/reports" icon={BarChart3} label="États" hint="Bilan, résultat" tint="96% 0.032 235" iconColor="text-info-ink" />
              <ActionTile href="/lettering" icon={Link2} label="Lettrer" hint="Tiers 40x / 41x" tint="96% 0.05 72" iconColor="text-warn-ink" />
              <ActionTile href="/imports" icon={FileUp} label="Importer" hint="Sage, CSV, PDF" tint="96.5% 0.02 300" iconColor="text-ink" />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* ─── Soft stat tile ──────────────────────────────────────────── */

function StatTile({
  tint,
  icon: Icon,
  iconColor,
  value,
  unit,
  label,
  sub,
  trend,
  href,
  valueSmall,
}: {
  tint: string;
  icon: LucideIcon;
  iconColor: string;
  value: string;
  unit?: string;
  label: string;
  sub?: string;
  trend?: number | null;
  href?: string;
  valueSmall?: boolean;
}) {
  const body = (
    <div
      className={cn('h-full rounded-2xl p-5 transition-transform duration-base', SOFT_SHADOW, href && 'hover:-translate-y-0.5')}
      style={{ backgroundColor: `oklch(${tint})` }}
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-paper/80 shadow-sm">
          <Icon className={cn('h-5 w-5', iconColor)} strokeWidth={1.5} />
        </span>
        {typeof trend === 'number' && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full bg-paper/70 px-2 py-0.5 text-xs font-medium',
              trend >= 0 ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            {trend >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} /> : <ArrowDownRight className="h-3.5 w-3.5" strokeWidth={2} />}
            {Math.abs(trend).toFixed(0)} %
          </span>
        )}
      </div>
      <p className={cn('num mt-4 font-bold tabular-nums text-ink', valueSmall ? 'text-xl' : 'text-3xl')}>
        {value}
        {unit && <span className="ml-1 text-sm font-medium text-ink-mute">{unit}</span>}
      </p>
      <p className="mt-0.5 text-sm font-medium text-ink-soft">{label}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-mute">{sub}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ─── Friendly task row ───────────────────────────────────────── */

function TaskRow({ href, label, count }: { href: string; label: string; count: number }) {
  const done = count === 0;
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors duration-fast',
        done ? 'opacity-55' : 'hover:bg-sunk',
      )}
    >
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums',
          done ? 'bg-accent-soft text-accent-ink' : 'bg-warn-soft text-warn-ink',
        )}
      >
        {done ? <Sparkles className="h-4 w-4" strokeWidth={1.5} /> : count}
      </span>
      <span className="flex-1 text-sm text-ink">{done ? `Aucune ${label}` : label}</span>
      {!done && (
        <ArrowRight className="h-4 w-4 text-ink-mute transition-transform duration-fast group-hover:translate-x-0.5" strokeWidth={1.5} />
      )}
    </Link>
  );
}

/* ─── Action launcher ─────────────────────────────────────────── */

function ActionTile({
  href,
  icon: Icon,
  label,
  hint,
  tint,
  iconColor,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  tint: string;
  iconColor: string;
}) {
  return (
    <Link
      href={href}
      className={cn('group flex flex-col gap-3 rounded-2xl p-5 transition-transform duration-base hover:-translate-y-1', SOFT_SHADOW)}
      style={{ backgroundColor: `oklch(${tint})` }}
    >
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-paper/85 shadow-sm">
        <Icon className={cn('h-6 w-6', iconColor)} strokeWidth={1.5} />
      </span>
      <div>
        <span className="block text-base font-semibold text-ink">{label}</span>
        <span className="block text-xs text-ink-mute">{hint}</span>
      </div>
    </Link>
  );
}

/* ─── Welcome (not configured) ────────────────────────────────── */

function WelcomeSetup() {
  return (
    <div className={cn('rounded-3xl bg-[oklch(96%_0.04_155)] p-8 text-center sm:p-10', SOFT_SHADOW)}>
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-paper text-accent-ink shadow-sm">
        <Sparkles className="h-7 w-7" strokeWidth={1.5} />
      </span>
      <h2 className="mt-5 font-display text-2xl text-ink">Bienvenue ! Configurons votre dossier</h2>
      <p className="mx-auto mt-2 max-w-[48ch] text-base leading-relaxed text-ink-soft">
        Ouvrez votre premier exercice comptable : c’est l’étape qui débloque la saisie, les états et
        le suivi. Ça prend une minute.
      </p>
      <Link
        href="/accounting-periods"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-canvas shadow-sm transition-transform duration-base hover:-translate-y-0.5"
      >
        Ouvrir un exercice <ArrowRight className="h-4 w-4" strokeWidth={2} />
      </Link>
    </div>
  );
}
