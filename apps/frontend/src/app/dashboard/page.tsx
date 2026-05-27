'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Banknote, BookText, Link2, Loader2, Percent } from 'lucide-react';
import Link from 'next/link';

import { AppShell } from '@/components/app-shell';
import { api, ApiError } from '@/lib/api-client';
import { useCurrentOrg, useCurrentUser } from '@/stores/auth-store';

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

/* ─── Page ───────────────────────────────────────────────────── */

export default function DashboardPage() {
  const user = useCurrentUser();
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

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

  const s = data?.daySummary;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] animate-page-in space-y-14">
        {/* ─── Editorial header ─────────────────────────────── */}
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

        {/* ─── À traiter aujourd'hui ────────────────────────── */}
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
              <span>Tout voir</span>
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
            <ul className="divide-y divide-line">
              <TaskRow
                icon={BookText}
                label="Écritures en attente"
                detail="Journaux en statut brouillon"
                count={s?.pending.entries ?? 0}
                href="/entry-workflow"
                tone="warn"
              />
              <TaskRow
                icon={Banknote}
                label="Lignes bancaires à rapprocher"
                detail="Relevés non pointés"
                count={s?.pending.bankLines ?? 0}
                href="/bank-reconciliation"
                tone="info"
              />
              <TaskRow
                icon={Link2}
                label="Lignes auxiliaires à lettrer"
                detail="Comptes 40x / 41x non lettrés"
                count={s?.pending.auxLettering ?? 0}
                href="/lettering"
                tone="info"
              />
              <TaskRow
                icon={Percent}
                label="Déclarations TVA"
                detail="Brouillon ou calculée, non déposée"
                count={s?.pending.tvaDeclarations ?? 0}
                href="/tva"
                tone={s?.pending.tvaDeclarations ? 'critical' : 'info'}
              />
            </ul>
          )}
        </section>

        {/* ─── Activity + Snapshot ──────────────────────────── */}
        <section className="grid gap-14 lg:grid-cols-[1.5fr_1fr]">
          {/* Activity timeline */}
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
              <p className="py-4 text-sm text-ink-mute">Aucune activité enregistrée.</p>
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
  if (key.includes('validate') || key.includes('commit') || key.includes('close')) {
    return 'bg-accent';
  }
  if (key.includes('cancel')) return 'bg-critical';
  if (key === 'auth.login') return 'bg-ink-mute';
  return 'bg-info';
}

/* ─── Subcomponents ──────────────────────────────────────────── */

interface TaskRowProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  detail: string;
  count: number;
  href: string;
  tone: 'info' | 'warn' | 'critical';
}

function TaskRow({ icon: Icon, label, detail, count, href, tone }: TaskRowProps) {
  const toneColor = {
    info: 'text-info-ink',
    warn: 'text-warn-ink',
    critical: 'text-critical-ink',
  }[tone];

  const hasItems = count > 0;

  return (
    <li>
      <Link
        href={href}
        className="press group flex items-center gap-4 py-3.5 transition-colors duration-fast hover:bg-sunk/50"
      >
        {/* Count — left, large, tone-colored when non-zero */}
        <div
          className={`w-14 shrink-0 text-right font-mono text-3xl font-medium tabular-nums transition-colors ${
            hasItems ? toneColor : 'text-ink opacity-20'
          }`}
        >
          {count}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.5} />
            <span className="text-sm font-medium text-ink">{label}</span>
          </div>
          <div className="mt-0.5 text-xs text-ink-mute">{detail}</div>
        </div>

        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-ink-mute opacity-0 transition-all duration-fast group-hover:translate-x-0.5 group-hover:opacity-100"
          strokeWidth={1.5}
        />
      </Link>
    </li>
  );
}

function ActivityTimeline({ items }: { items: DaySummaryActivity[] }) {
  return (
    <ol className="relative space-y-5">
      {/* Vertical connector */}
      <span
        aria-hidden
        className="absolute bottom-[10px] left-[4px] top-[10px] w-px bg-line"
      />

      {items.map((item, i) => (
        <li key={i} className="relative flex pl-6">
          {/* Dot */}
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
      <svg
        width="56"
        height="56"
        viewBox="0 0 56 56"
        fill="none"
        className="absolute inset-0"
        aria-hidden
      >
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
      <span className={`font-mono text-xs font-medium tabular-nums ${textColor}`}>
        {value}
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
}: SnapshotBlockProps) {
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
              accent ? 'text-accent-ink' : 'text-ink'
            } ${numeric ? 'font-mono tabular-nums' : ''}`}
          >
            {value}
          </p>
          <p className="mt-1 text-xs text-ink-mute">{sub}</p>
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
