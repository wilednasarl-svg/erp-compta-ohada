'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Award, Banknote, BookText, Link2, Loader2, Percent } from 'lucide-react';
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

  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const { data, isLoading } = useQuery<{ daySummary: DaySummary }, ApiError>({
    queryKey: ['day-summary', orgId],
    queryFn: () => api.get<{ daySummary: DaySummary }>(`/organizations/${orgId}/dashboards/day-summary`),
    enabled: orgId !== '',
    staleTime: 60_000,
  });

  const s = data?.daySummary;

  return (
    <AppShell>
      <div className="mx-auto max-w-[1200px] space-y-12">
        {/* ─── Page header ──────────────────────────────────────── */}
        <header className="space-y-2">
          <p className="eyebrow">
            {today.charAt(0).toUpperCase() + today.slice(1)}
          </p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Bonjour {user?.firstName ?? user?.email?.split('@')[0] ?? ''}.
          </h1>
          <p className="max-w-[68ch] text-sm leading-relaxed text-ink-soft">
            Voici l'état du dossier{' '}
            <span className="font-medium text-ink">{currentOrg?.name ?? '—'}</span> pour aujourd'hui.
            Vous intervenez en tant que{' '}
            <span className="font-medium text-ink">{currentOrg?.role ?? '—'}</span>.
          </p>
        </header>

        {/* ─── À traiter aujourd'hui ────────────────────────────── */}
        <section aria-labelledby="todo-title" className="border-y border-line py-8">
          <div className="mb-6 flex items-baseline justify-between gap-4">
            <div>
              <p className="eyebrow mb-1">Priorité du jour</p>
              <h2 id="todo-title" className="font-display text-2xl font-medium text-ink">
                À traiter aujourd'hui
              </h2>
            </div>
            <Link
              href="/entry-workflow"
              className="group inline-flex items-center gap-1 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
            >
              <span>Tout voir</span>
              <ArrowUpRight className="h-3 w-3 transition-transform duration-fast group-hover:-translate-y-px group-hover:translate-x-px" strokeWidth={1.5} />
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
                label="Écritures en attente de validation"
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
                label="Déclarations TVA en cours"
                detail="Brouillon ou calculée, non déposée"
                count={s?.pending.tvaDeclarations ?? 0}
                href="/tva"
                tone={s?.pending.tvaDeclarations ? 'critical' : 'info'}
              />
            </ul>
          )}
        </section>

        {/* ─── Activité + Snapshot ──────────────────────────────── */}
        <section className="grid gap-12 lg:grid-cols-[1.5fr_1fr]">
          {/* Activité récente */}
          <div>
            <p className="eyebrow mb-1">Activité du dossier</p>
            <h2 className="mb-4 font-display text-xl font-medium text-ink">
              Derniers mouvements
            </h2>

            {isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-ink-mute">
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              </div>
            ) : (s?.recentActivity.length ?? 0) === 0 ? (
              <p className="py-4 text-sm text-ink-mute">Aucune activité enregistrée.</p>
            ) : (
              <ol className="space-y-4">
                {s?.recentActivity.map((item, i) => (
                  <ActivityRow key={i} item={item} />
                ))}
              </ol>
            )}

            <Link
              href="/audit-logs"
              className="mt-6 inline-flex items-center gap-1 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
            >
              <span>Voir le journal d'audit complet</span>
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          </div>

          {/* Snapshot */}
          <div className="space-y-8 border-l border-line pl-10 lg:pl-12">
            <SnapshotBlock
              label="Exercice en cours"
              value={s?.exercise?.label ?? '—'}
              sub={s?.exercise ? `ouvert le ${fmtDate(s.exercise.startDate)}` : 'Aucun exercice ouvert'}
            />
            <SnapshotBlock
              label="Période active"
              value={s?.activePeriod?.label ?? '—'}
              sub={s?.activePeriod ? `clôture le ${fmtDate(s.activePeriod.endDate)}` : 'Aucune période ouverte'}
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
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmt(n: number): string {
  return new Intl.NumberFormat('fr-FR').format(n);
}

function actionLabel(item: DaySummaryActivity): string {
  const labels: Record<string, string> = {
    'journal_entries.create': 'a créé une écriture',
    'journal_entries.validate': 'a validé une écriture',
    'journal_entries.cancel': 'a annulé une écriture',
    'imports.create': 'a démarré un import',
    'imports.commit': 'a validé un import',
    'tva.calculate': 'a calculé une déclaration TVA',
    'tva.cancel': 'a annulé une déclaration TVA',
    'bank_reconciliation.match': 'a rapproché des lignes',
    'lettering.apply': 'a lettré des écritures',
    'accounting_periods.close': 'a clôturé une période',
    'auth.login': "s'est connecté",
  };
  const key = `${item.module}.${item.action}`;
  return labels[key] ?? `${item.action.replace(/_/g, ' ')} (${item.module})`;
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
  const toneClasses = {
    info: 'text-info-ink bg-info-soft',
    warn: 'text-warn-ink bg-warn-soft',
    critical: 'text-critical-ink bg-critical-soft',
  }[tone];

  return (
    <li>
      <Link
        href={href}
        className="group flex items-center gap-4 py-3 transition-colors duration-fast hover:bg-sunk/40"
      >
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm ${toneClasses}`}>
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink">{label}</div>
          <div className="text-xs text-ink-mute">{detail}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-medium tabular-nums text-ink">{count}</div>
        </div>
        <ArrowUpRight
          className="h-4 w-4 shrink-0 text-ink-mute opacity-0 transition-all duration-fast group-hover:translate-x-0.5 group-hover:opacity-100"
          strokeWidth={1.5}
        />
      </Link>
    </li>
  );
}

function ActivityRow({ item }: { item: DaySummaryActivity }) {
  return (
    <li className="flex gap-4">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink-mute" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className="font-medium text-ink-soft">{item.module}</span>{' '}
          <span className="text-ink-soft">—</span>{' '}
          <span>{actionLabel(item)}</span>
          {item.entityType ? (
            <span className="text-ink-mute"> ({item.entityType})</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-ink-mute">{fmtRelative(item.createdAt)}</p>
      </div>
    </li>
  );
}

interface SnapshotBlockProps {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  numeric?: boolean;
  href?: string;
}

function SnapshotBlock({ label, value, sub, accent, numeric, href }: SnapshotBlockProps) {
  const inner = (
    <>
      <p className="eyebrow">{label}</p>
      <p
        className={`mt-1.5 font-display text-3xl font-medium tracking-tight ${
          accent ? 'text-accent-ink' : 'text-ink'
        } ${numeric ? 'font-mono tabular-nums' : ''}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-mute">{sub}</p>
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
