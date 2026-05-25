'use client';

import { ArrowUpRight, BookText, Banknote, Link2, Percent } from 'lucide-react';
import Link from 'next/link';

import { AppShell } from '@/components/app-shell';
import { useCurrentOrg, useCurrentUser } from '@/stores/auth-store';

/**
 * Dashboard — editorial landing surface.
 *
 * No hero-metric template, no identical-card grid. The page is structured
 * as a newspaper front page would be: a single primary attention block
 * ("À traiter aujourd'hui"), a secondary recent activity column, and a
 * third "État du dossier" snapshot — each with its own typographic
 * weight rather than uniform card containers.
 *
 * All numbers are placeholders until the backend KPIs are wired (Module 2+).
 * They demonstrate the visual language; the data plumbing replaces them.
 */
export default function DashboardPage() {
  const user = useCurrentUser();
  const currentOrg = useCurrentOrg();

  const today = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

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

        {/* ─── À traiter aujourd'hui — primary attention block ──── */}
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
              <ArrowUpRight
                className="h-3 w-3 transition-transform duration-fast group-hover:-translate-y-px group-hover:translate-x-px"
                strokeWidth={1.5}
              />
            </Link>
          </div>

          <ul className="divide-y divide-line">
            <TaskRow
              icon={BookText}
              label="Écritures en attente de validation"
              detail="JV, BAN, OD"
              count={12}
              href="/entry-workflow"
              tone="warn"
            />
            <TaskRow
              icon={Banknote}
              label="Lignes bancaires à rapprocher"
              detail="SGBCI, NSIA, Ecobank"
              count={47}
              href="/bank-reconciliation"
              tone="info"
            />
            <TaskRow
              icon={Link2}
              label="Comptes auxiliaires à lettrer"
              detail="411, 401"
              count={8}
              href="/lettering"
              tone="info"
            />
            <TaskRow
              icon={Percent}
              label="Déclaration TVA — Avril 2026"
              detail="échéance 15 mai"
              count={1}
              href="/tva"
              tone="critical"
            />
          </ul>
        </section>

        {/* ─── Two columns : Activité + Snapshot ────────────────── */}
        <section className="grid gap-12 lg:grid-cols-[1.5fr_1fr]">
          {/* Activité récente */}
          <div>
            <p className="eyebrow mb-1">Activité du dossier</p>
            <h2 className="mb-4 font-display text-xl font-medium text-ink">
              Derniers mouvements
            </h2>

            <ol className="space-y-4">
              <ActivityRow
                time="il y a 14 min"
                actor="Awa Koffi"
                verb="a validé"
                target="lot d'écritures JV-2026-04-018"
                hint="34 lignes, 4 250 000 FCFA"
              />
              <ActivityRow
                time="il y a 1 h"
                actor="Import Sage"
                verb="a importé"
                target="balance avril 2026"
                hint="1 247 lignes, 0 anomalie"
              />
              <ActivityRow
                time="il y a 2 h"
                actor="Kouamé Yao"
                verb="a lettré"
                target="compte 411-AKILA"
                hint="6 écritures équilibrées"
              />
              <ActivityRow
                time="hier, 17 : 42"
                actor="IA — Anomalies"
                verb="a signalé"
                target="3 doublons potentiels journal BAN"
                hint="à examiner"
                tone="warn"
              />
              <ActivityRow
                time="hier, 11 : 03"
                actor="Système"
                verb="a clôturé"
                target="période Mars 2026"
                hint="verrouillage automatique"
              />
            </ol>

            <Link
              href="/audit-logs"
              className="mt-6 inline-flex items-center gap-1 text-xs text-ink-soft transition-colors duration-fast hover:text-ink"
            >
              <span>Voir le journal d'audit complet</span>
              <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          </div>

          {/* Snapshot — état du dossier */}
          <div className="space-y-8 border-l border-line pl-10 lg:pl-12">
            <SnapshotBlock label="Exercice en cours" value="2026" sub="ouvert le 01/01/2026" />
            <SnapshotBlock
              label="Période active"
              value="Avril 2026"
              sub="clôture prévue 15 mai"
              accent
            />
            <SnapshotBlock
              label="Écritures du mois"
              value="1 247"
              sub="dont 12 en attente"
              numeric
            />
            <SnapshotBlock
              label="Score santé"
              value="A−"
              sub="cohérence des soldes, lettrage, TVA"
              href="/accounting-score"
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
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
        <span
          className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm ${toneClasses}`}
        >
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

interface ActivityRowProps {
  time: string;
  actor: string;
  verb: string;
  target: string;
  hint?: string;
  tone?: 'default' | 'warn';
}

function ActivityRow({ time, actor, verb, target, hint, tone = 'default' }: ActivityRowProps) {
  return (
    <li className="flex gap-4">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-ink-mute" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className="font-medium">{actor}</span>{' '}
          <span className="text-ink-soft">{verb}</span>{' '}
          <span className="font-medium">{target}</span>
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-mute">
          <span>{time}</span>
          {hint ? (
            <>
              <span aria-hidden>·</span>
              <span className={tone === 'warn' ? 'text-warn-ink' : ''}>{hint}</span>
            </>
          ) : null}
        </p>
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
  const content = (
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
      <Link
        href={href}
        className="group block transition-colors duration-fast hover:text-ink"
      >
        {content}
        <span className="mt-1 inline-flex items-center gap-1 text-2xs uppercase tracking-wider text-ink-mute group-hover:text-ink-soft">
          <span>Détail</span>
          <ArrowUpRight className="h-3 w-3" strokeWidth={1.5} />
        </span>
      </Link>
    );
  }

  return <div>{content}</div>;
}
