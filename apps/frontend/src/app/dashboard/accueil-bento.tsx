'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BookText,
  CalendarCheck,
  FileUp,
  Link2,
  Percent,
  Banknote,
  PenLine,
  BarChart3,
  Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/* ─── Types (subset of the dashboard day-summary) ─────────────── */

interface PendingCounts {
  entries: number;
  bankLines: number;
  auxLettering: number;
  tvaDeclarations: number;
}

interface RecentActivity {
  module: string;
  action: string;
  entityType: string | null;
  createdAt: string;
}

export interface AccueilSummary {
  pending: PendingCounts;
  exercise: { label: string } | null;
  activePeriod: { label: string; endDate: string } | null;
  entriesThisMonth: number;
  score: { value: number; grade: string } | null;
  recentActivity: RecentActivity[];
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

/* ─── Helpers ─────────────────────────────────────────────────── */

function formatFcfa(value: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)} FCFA`;
}

function scoreTone(value: number): { ring: string; text: string; word: string } {
  if (value >= 80) return { ring: 'oklch(var(--accent))', text: 'text-accent-ink', word: 'Très bon' };
  if (value >= 60) return { ring: 'oklch(var(--warn))', text: 'text-warn-ink', word: 'Correct' };
  return { ring: 'oklch(var(--critical))', text: 'text-critical-ink', word: 'À surveiller' };
}

const MODULE_ICON: Record<string, LucideIcon> = {
  journal: BookText,
  entry: PenLine,
  lettering: Link2,
  bank: Banknote,
  tva: Percent,
  report: BarChart3,
  import: FileUp,
};

function moduleIcon(module: string): LucideIcon {
  const key = Object.keys(MODULE_ICON).find((k) => module.toLowerCase().includes(k));
  return key ? MODULE_ICON[key]! : Sparkles;
}

function relTime(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} j`;
}

/* ─── Component ────────────────────────────────────────────────── */

export function AccueilBento({
  orgId,
  exerciseId,
  userName,
  orgName,
  summary,
  isLoading,
  greeting,
  dateLabel,
}: AccueilBentoProps) {
  const treasuryQuery = useQuery<number | null, ApiError>({
    queryKey: ['accueil-treasury', orgId, exerciseId],
    queryFn: async () => {
      const data = await api.get<{ cashBalance?: string }>(
        `/organizations/${orgId}/dashboards/summary?exerciseId=${exerciseId}`,
      );
      return data.cashBalance != null ? parseFloat(data.cashBalance) : null;
    },
    enabled: orgId !== '' && exerciseId !== '',
    staleTime: 60_000,
  });

  const notConfigured = !isLoading && !summary?.exercise;
  const pending = summary?.pending;
  const pendingTotal = pending
    ? pending.entries + pending.bankLines + pending.auxLettering + pending.tvaDeclarations
    : 0;
  const now = Date.now();

  return (
    <section aria-label="Accueil" className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="font-display text-4xl leading-none text-ink">
          {greeting} {userName}
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Voici l’essentiel de <span className="font-medium text-ink">{orgName}</span>, {dateLabel}.
        </p>
      </div>

      {notConfigured ? (
        <WelcomeSetup />
      ) : (
        <>
          {/* Bento grid — varied tile sizes, never a uniform card grid */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:grid-rows-2">
            {/* Santé — large focal tile */}
            <div className="col-span-2 row-span-2 flex flex-col justify-between rounded-lg border border-line bg-paper p-6">
              <p className="eyebrow">Santé du dossier</p>
              <div className="flex items-center gap-6 py-2">
                <ScoreGauge value={summary?.score?.value ?? null} loading={isLoading} />
                <div>
                  {summary?.score ? (
                    <>
                      <p className={cn('text-2xl font-semibold', scoreTone(summary.score.value).text)}>
                        {scoreTone(summary.score.value).word}
                      </p>
                      <p className="mt-1 text-sm text-ink-mute">
                        Indice qualité OHADA, mis à jour en continu.
                      </p>
                      <Link
                        href="/accounting-score"
                        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline"
                      >
                        Voir le détail <ArrowRight className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </Link>
                    </>
                  ) : (
                    <p className="text-sm text-ink-mute">Le score apparaîtra dès vos premières écritures.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Trésorerie — wide tile */}
            <div className="col-span-2 flex flex-col justify-between rounded-lg border border-line bg-paper p-6">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Trésorerie</p>
                <Banknote className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
              </div>
              <p className="num mt-3 text-3xl font-semibold tabular-nums text-ink">
                {treasuryQuery.isLoading
                  ? '···'
                  : treasuryQuery.data != null
                    ? formatFcfa(treasuryQuery.data)
                    : '—'}
              </p>
              <Link
                href="/dashboards/treasury"
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-ink hover:underline"
              >
                Trésorerie détaillée <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
              </Link>
            </div>

            {/* À traiter — count + breakdown */}
            <div className="col-span-1 rounded-lg border border-line bg-paper p-5">
              <p className="eyebrow">À traiter</p>
              <p
                className={cn(
                  'mt-1 text-3xl font-semibold tabular-nums',
                  pendingTotal > 0 ? 'text-warn-ink' : 'text-accent-ink',
                )}
              >
                {pendingTotal}
              </p>
              <ul className="mt-3 space-y-1.5">
                <PendingRow href="/entry-workflow" label="Écritures" count={pending?.entries ?? 0} />
                <PendingRow href="/bank-reconciliation" label="Banque" count={pending?.bankLines ?? 0} />
                <PendingRow href="/lettering" label="Lettrage" count={pending?.auxLettering ?? 0} />
                <PendingRow href="/tva" label="TVA" count={pending?.tvaDeclarations ?? 0} />
              </ul>
            </div>

            {/* Période */}
            <div className="col-span-1 flex flex-col justify-between rounded-lg border border-line bg-paper p-5">
              <div className="flex items-center justify-between">
                <p className="eyebrow">Période</p>
                <CalendarCheck className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
              </div>
              <div className="mt-3">
                <p className="text-lg font-semibold text-ink">
                  {summary?.activePeriod?.label ?? '—'}
                </p>
                <p className="mt-0.5 text-xs text-ink-mute">{summary?.exercise?.label ?? ''}</p>
              </div>
              <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-xs bg-accent-soft px-2 py-1 text-2xs uppercase tracking-wider text-accent-ink">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                Ouverte
              </span>
            </div>
          </div>

          {/* Activité récente — full-width visual strip */}
          {(summary?.recentActivity.length ?? 0) > 0 && (
            <div className="rounded-lg border border-line bg-paper p-5">
              <p className="eyebrow mb-3">Activité récente</p>
              <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {summary!.recentActivity.slice(0, 6).map((a, i) => {
                  const Icon = moduleIcon(a.module);
                  return (
                    <li key={`${a.createdAt}-${i}`} className="flex items-center gap-2.5">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-sunk text-ink-soft">
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.action}</span>
                      <span className="shrink-0 text-2xs text-ink-mute">{relTime(a.createdAt, now)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

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

/* ─── Subcomponents ───────────────────────────────────────────── */

function ScoreGauge({ value, loading }: { value: number | null; loading: boolean }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const pct = value != null ? Math.max(0, Math.min(100, value)) / 100 : 0;
  const tone = value != null ? scoreTone(value).ring : 'oklch(var(--line-strong))';

  return (
    <div className="relative h-28 w-28 shrink-0">
      <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="oklch(var(--sunk))" strokeWidth="9" />
        {value != null && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-2xl font-semibold tabular-nums text-ink">
          {loading ? '··' : value != null ? value : '—'}
        </span>
        {value != null && <span className="text-2xs uppercase tracking-wider text-ink-mute">sur 100</span>}
      </div>
    </div>
  );
}

function PendingRow({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between rounded-sm px-1.5 py-1 text-xs transition-colors duration-fast hover:bg-sunk"
      >
        <span className="text-ink-soft">{label}</span>
        <span
          className={cn(
            'num tabular-nums font-medium',
            count > 0 ? 'text-warn-ink' : 'text-ink-mute',
          )}
        >
          {count}
        </span>
      </Link>
    </li>
  );
}

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
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
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
