'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Loader2, Lock, Unlock } from 'lucide-react';
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

/**
 * `/accounting-periods` — gestion des exercices et sous-périodes
 * comptables (Module 8).
 *
 * UX :
 *   - formulaire haut : créer un exercice (calendrier ou décalé).
 *   - liste hiérarchique : exercice annuel → sous-périodes (trimestres
 *     ou mois) avec badge open/closed.
 *   - actions par ligne : Fermer (cascade enfants) / Réouvrir
 *     (motif obligatoire).
 */
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

  // Tree : roots = parentId null, sorted by startDate asc.
  const tree = useMemo(() => {
    const all = periodsQuery.data ?? [];
    const roots = all.filter((p) => p.parentId === null).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const childrenOf = (id: string) =>
      all.filter((p) => p.parentId === id).sort((a, b) => a.startDate.localeCompare(b.startDate));
    return roots.map((r) => ({ root: r, children: childrenOf(r.id) }));
  }, [periodsQuery.data]);

  // ─── Création ───────────────────────────────────────────────────────
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

  return (
    <AppShell>
      <div className="mx-auto max-w-[1100px] animate-page-in space-y-12">
        <header className="border-b border-line pb-3">
          <p className="eyebrow mb-2">Référentiel</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
            Périodes comptables
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Exercices fiscaux et sous-périodes. Un exercice peut être calendaire (1er janv.)
            ou décalé (ex. campagne agricole 1er avril). Fermer une période bloque toute
            saisie ; réouvrir exige un motif.
          </p>
        </header>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Nouvel exercice</h2>
            <p className="mt-1 text-sm text-ink-mute">
              Omettre la date de début pour un exercice calendaire (Jan 1 → Déc 31).
            </p>
          </div>
          <div className="rounded-sm border border-line bg-paper p-5">
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
                  className="rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
                >
                  <option value="MONTHLY">Mensuel</option>
                  <option value="QUARTERLY">Trimestriel</option>
                  <option value="ANNUAL_ONLY">Annuel seul</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="startDate">Date début (optionnel)</Label>
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
                Créer
              </Button>
            </form>
            <FormError error={create.error} className="mt-3" />
          </div>
        </section>

        <section className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Exercices existants</h2>
          </div>
          <div className="rounded-sm border border-line bg-paper p-5">
            {periodsQuery.isLoading ? (
              <p className="text-sm text-ink-mute">Chargement…</p>
            ) : tree.length === 0 ? (
              <p className="text-sm text-ink-mute">Aucun exercice créé.</p>
            ) : (
              <div className="space-y-4">
                {tree.map(({ root, children }) => (
                  <div key={root.id} className="rounded-sm border border-line">
                    <PeriodRow orgId={orgId} period={root} bold />
                    {children.length > 0 && (
                      <ul className="divide-y divide-line border-t border-line bg-sunk/20">
                        {children.map((c) => (
                          <li key={c.id} className="pl-6">
                            <PeriodRow orgId={orgId} period={c} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            <FormError error={periodsQuery.error} className="mt-3" />
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function PeriodRow({
  orgId,
  period,
  bold,
}: {
  orgId: string;
  period: AccountingPeriodView;
  bold?: boolean;
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

  const statusClass =
    period.status === 'open'
      ? 'bg-accent-soft text-accent-ink'
      : 'bg-sunk text-ink-mute';

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={bold ? 'font-semibold text-ink' : 'text-ink'}>{period.label}</span>
          <span
            className={`inline-block rounded-xs px-2 py-0.5 font-mono text-[11px] ${statusClass}`}
          >
            {period.status === 'open' ? 'Ouvert' : 'Fermé'}
          </span>
          <span className="text-xs text-ink-mute">{period.kind}</span>
        </div>
        <div className="text-xs text-ink-mute">
          {period.startDate} → {period.endDate}
        </div>
        {showReopen && (
          <div className="mt-2 flex gap-2">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Motif de réouverture (obligatoire)"
              className="h-8"
              maxLength={500}
            />
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="press"
              disabled={reopen.isPending || reason.trim() === ''}
              onClick={() => reopen.mutate(undefined)}
            >
              Confirmer
            </Button>
          </div>
        )}
        <FormError error={close.error} className="mt-1" />
        <FormError error={reopen.error} className="mt-1" />
      </div>
      <div className="flex shrink-0 gap-2">
        {period.status === 'open' ? (
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
              <Lock className="mr-1 h-3 w-3" />
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
            <Unlock className="mr-1 h-3 w-3" />
            Réouvrir
          </Button>
        )}
      </div>
    </div>
  );
}
