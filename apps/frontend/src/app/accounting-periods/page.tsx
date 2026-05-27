'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CalendarPlus,
  Loader2,
  Lock,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';

type Split = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL_ONLY';

interface PeriodsResponse {
  readonly periods: ReadonlyArray<AccountingPeriodView>;
}

function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div className="animate-pulse space-y-px">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="h-3 w-14 rounded-xs bg-sunk" />
          <div className="h-3 w-32 flex-1 rounded-xs bg-sunk" />
          <div className="h-5 w-14 rounded-full bg-sunk" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk">
        <Icon className="h-5 w-5 text-ink-mute" strokeWidth={1.5} />
      </span>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="mt-1 max-w-[40ch] text-xs text-ink-mute">{description}</p>
      </div>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          <CalendarPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {actionLabel}
        </Link>
      )}
      {actionLabel && !actionHref && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="press inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          <CalendarPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: 'open' | 'closed' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        status === 'open' ? 'bg-accent-soft text-accent-ink' : 'bg-sunk text-ink-mute'
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status === 'open' ? 'Ouvert' : 'Fermé'}
    </span>
  );
}

export default function AccountingPeriodsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();

  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const data = await api.get<PeriodsResponse>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return data.periods;
    },
    enabled: orgId !== '',
  });

  const tree = useMemo(() => {
    const all = periodsQuery.data ?? [];
    const roots = all
      .filter((p) => p.parentId === null)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const childrenOf = (id: string) =>
      all
        .filter((p) => p.parentId === id)
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    return roots.map((r) => ({ root: r, children: childrenOf(r.id) }));
  }, [periodsQuery.data]);

  const totals = useMemo(() => {
    const all = periodsQuery.data ?? [];
    const roots = all.filter((p) => p.parentId === null);
    const openRoots = roots.filter((p) => p.status === 'open').length;
    return { exercises: roots.length, open: openRoots, closed: roots.length - openRoots };
  }, [periodsQuery.data]);

  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const [split, setSplit] = useState<Split>('MONTHLY');
  const [startDate, setStartDate] = useState('');

  const create = useApiMutation(
    async () => {
      const body: Record<string, unknown> = { year, split };
      if (startDate.trim() !== '') body.startDate = startDate.trim();
      return api.post(`/organizations/${orgId}/accounting-periods`, body);
    },
    {
      onSuccess: () => {
        setStartDate('');
        void qc.invalidateQueries({ queryKey: ['accounting-periods', orgId] });
      },
    },
  );

  const scrollToForm = () => {
    document.getElementById('new-exercise-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1100px] animate-page-in space-y-12">
        <header className="flex items-start justify-between gap-6 border-b border-line pb-6">
          <div>
            <p className="eyebrow mb-2">Référentiel</p>
            <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
              Périodes comptables
            </h1>
            <p className="mt-2 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
              Exercices fiscaux et sous-périodes. Un exercice peut être calendaire
              (1<sup>er</sup> janvier) ou décalé (campagne agricole, exercice fiscal
              propre). Fermer une période bloque toute saisie ; la réouverture exige un
              motif tracé en audit.
            </p>
          </div>
          {totals.exercises > 0 && (
            <div className="hidden shrink-0 grid-cols-3 gap-3 sm:grid">
              <Stat label="Exercices" value={totals.exercises} />
              <Stat label="Ouverts" value={totals.open} tone="accent" />
              <Stat label="Fermés" value={totals.closed} tone="mute" />
            </div>
          )}
        </header>

        <section className="space-y-4">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <div>
              <h2 className="font-display text-xl font-medium text-ink">Nouvel exercice</h2>
              <p className="mt-1 text-sm text-ink-mute">
                Omettre la date de début pour un exercice calendaire (1
                <sup>er</sup> janvier → 31 décembre).
              </p>
            </div>
            <span className="hidden text-xs text-ink-mute md:inline">
              Découpage interne en {split === 'MONTHLY' ? '12 mois' : split === 'QUARTERLY' ? '4 trimestres' : 'aucune sous-période'}
            </span>
          </div>
          <div
            id="new-exercise-form"
            className="rounded-sm border border-line bg-paper p-5 shadow-[0_1px_0_rgba(0,0,0,0.02)]"
          >
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-[120px_180px_180px_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate(undefined);
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="year">Année</Label>
                <Input
                  id="year"
                  type="number"
                  min="2000"
                  max="2100"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="split">Découpage</Label>
                <select
                  id="split"
                  value={split}
                  onChange={(e) => setSplit(e.target.value as Split)}
                  className="w-full rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none"
                >
                  <option value="MONTHLY">Mensuel (12)</option>
                  <option value="QUARTERLY">Trimestriel (4)</option>
                  <option value="ANNUAL_ONLY">Annuel seul</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="startDate">Date début (décalé)</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  placeholder="2026-04-01"
                />
              </div>
              <Button type="submit" disabled={create.isPending} className="press">
                {create.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CalendarPlus className="mr-2 h-4 w-4" />
                )}
                Créer l&apos;exercice
              </Button>
            </form>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-mute">
              <ShieldCheck className="h-3.5 w-3.5 text-ink-mute" strokeWidth={1.75} />
              Astuce : un exercice décalé commence ailleurs qu&apos;au 1<sup>er</sup> janvier
              (ex. 1<sup>er</sup> avril pour une campagne agricole).
            </p>
            <FormError error={create.error} className="mt-3" />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-baseline justify-between border-b border-line pb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="font-display text-xl font-medium text-ink">
                Exercices existants
              </h2>
              {!periodsQuery.isLoading && tree.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-sunk px-2 py-0.5 font-mono text-[11px] text-ink-mute">
                  {tree.length} exercice{tree.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <div className="rounded-sm border border-line bg-paper">
            {periodsQuery.isLoading ? (
              <SkeletonRows n={4} />
            ) : tree.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="Aucun exercice comptable"
                description="Créez votre premier exercice comptable pour commencer la saisie."
                actionLabel={`Créer l'exercice ${currentYear}`}
                onAction={scrollToForm}
              />
            ) : (
              <div className="divide-y divide-line">
                {tree.map(({ root, children }) => (
                  <div key={root.id} className="overflow-hidden">
                    <PeriodRow orgId={orgId} period={root} bold />
                    {children.length > 0 && (
                      <ul className="divide-y divide-line/70 border-t border-line bg-sunk/30">
                        {children.map((c) => (
                          <li key={c.id}>
                            <PeriodRow orgId={orgId} period={c} indented />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            <FormError error={periodsQuery.error} className="m-4" />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'accent' | 'mute';
}) {
  const toneClass =
    tone === 'accent'
      ? 'text-accent-ink'
      : tone === 'mute'
        ? 'text-ink-mute'
        : 'text-ink';
  return (
    <div className="min-w-[88px] rounded-sm border border-line bg-paper px-3 py-2 text-right">
      <p className="eyebrow mb-1 text-right">{label}</p>
      <p className={`font-mono text-lg font-medium tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function PeriodRow({
  orgId,
  period,
  bold,
  indented,
}: {
  orgId: string;
  period: AccountingPeriodView;
  bold?: boolean;
  indented?: boolean;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [showReopen, setShowReopen] = useState(false);

  const close = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/accounting-periods/${period.id}/close`, {}),
    {
      onSuccess: () => qc.invalidateQueries({ queryKey: ['accounting-periods', orgId] }),
    },
  );
  const reopen = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/accounting-periods/${period.id}/reopen`, {
        reason: reason.trim(),
      }),
    {
      onSuccess: () => {
        setReason('');
        setShowReopen(false);
        void qc.invalidateQueries({ queryKey: ['accounting-periods', orgId] });
      },
    },
  );

  const isOpen = period.status === 'open';

  return (
    <div
      className={`relative flex items-center justify-between gap-3 px-4 py-3 text-sm transition-colors duration-fast hover:bg-sunk/40 ${
        indented ? 'pl-10' : ''
      }`}
    >
      {isOpen && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 h-full w-[3px] bg-accent"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={
              bold
                ? 'font-display text-base font-medium text-ink'
                : 'text-sm text-ink'
            }
          >
            {period.label}
          </span>
          <StatusChip status={isOpen ? 'open' : 'closed'} />
          <span className="rounded-xs bg-sunk px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-mute">
            {period.kind}
          </span>
        </div>
        <div className="mt-1 font-mono text-xs tabular-nums text-ink-mute">
          {period.startDate} <span className="text-ink-mute/60">→</span> {period.endDate}
        </div>
        {showReopen && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motif de réouverture (obligatoire, tracé en audit)"
              className="h-8 flex-1"
              maxLength={500}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="press"
                disabled={reopen.isPending || reason.trim() === ''}
                onClick={() => reopen.mutate(undefined)}
              >
                {reopen.isPending ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Unlock className="mr-1 h-3 w-3" />
                )}
                Confirmer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="press"
                onClick={() => {
                  setShowReopen(false);
                  setReason('');
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
        <FormError error={close.error} className="mt-1" />
        <FormError error={reopen.error} className="mt-1" />
      </div>
      <div className="flex shrink-0 gap-2">
        {isOpen ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="press"
            disabled={close.isPending}
            onClick={() => close.mutate(undefined)}
          >
            {close.isPending ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <Lock className="mr-1 h-3 w-3" strokeWidth={1.75} />
            )}
            Fermer
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="press"
            onClick={() => setShowReopen((v) => !v)}
          >
            <Unlock className="mr-1 h-3 w-3" strokeWidth={1.75} />
            Réouvrir
          </Button>
        )}
      </div>
    </div>
  );
}
