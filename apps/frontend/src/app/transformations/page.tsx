'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  CheckCircle2,
  History,
  Loader2,
  Plus,
  Search,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

interface TransformationHistoryEntry {
  readonly id: string;
  readonly type: 'reclassify' | 'adjust';
  readonly createdAt: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly notes: string | null;
}

const SELECT_CLS =
  'flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors duration-fast focus:border-accent focus:outline-none';

function SkeletonRows({ n = 4 }: { n?: number }){
  return (
    <div className="animate-pulse divide-y divide-line">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          <div className="h-3 w-10 rounded-xs bg-sunk" />
          <div className="h-3 flex-1 rounded-xs bg-sunk" />
          <div className="h-3 w-20 rounded-xs bg-sunk" />
          <div className="h-5 w-16 rounded-full bg-sunk" />
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
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
}){
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
          className="inline-flex items-center gap-1.5 rounded-sm bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent hover:text-canvas"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: 'accent' | 'warn' | 'info' | 'critical' | 'neutral';
  children: React.ReactNode;
}){
  const styles: Record<typeof tone, string> = {
    accent: 'bg-accent-soft text-accent-ink',
    warn: 'bg-warn-soft text-warn-ink',
    info: 'bg-info-soft text-info-ink',
    critical: 'bg-critical-soft text-critical-ink',
    neutral: 'bg-sunk text-ink-mute',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * `/transformations` — retraitements comptables (Module 4).
 *
 * UX MVP : on saisit l'UUID d'une entry source, on voit son historique
 * de transformations, et on peut déclencher :
 *   - reclassify : changer le compte d'une ligne (génère une écriture
 *     contre-passante + une nouvelle).
 *   - adjust : ajouter un ajustement (débit OU crédit) sur la même entry.
 *
 * Les entries sources restent immutables — chaque transformation est
 * un artefact additionnel tracé dans l'historique.
 */
export default function TransformationsPage(){
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [entryIdInput, setEntryIdInput] = useState('');
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        {/* Hero header */}
        <header className="flex flex-col gap-6 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow mb-2">Clôturer · Reclassements</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              Reclassements &amp; ajustements
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Corriger une écriture sans casser la piste d&apos;audit : reclassement de compte ou
              ajustement complémentaire. Chaque correction est un artefact additionnel, traçable
              et réversible — les écritures sources restent intactes.
            </p>
          </div>
          <div className="hidden shrink-0 items-center gap-3 lg:flex">
            <div className="flex items-center gap-2 rounded-sm border border-line bg-paper px-3 py-2">
              <ArrowRightLeft className="h-4 w-4 text-info-ink" strokeWidth={1.5} />
              <div>
                <p className="eyebrow">Reclasser</p>
                <p className="text-xs text-ink-soft">Compte cible</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-sm border border-line bg-paper px-3 py-2">
              <Plus className="h-4 w-4 text-warn-ink" strokeWidth={1.5} />
              <div>
                <p className="eyebrow">Ajuster</p>
                <p className="text-xs text-ink-soft">Débit / Crédit</p>
              </div>
            </div>
          </div>
        </header>

        {/* Entry search */}
        <section className="overflow-hidden rounded-sm border border-line bg-paper">
          <header className="border-b border-line px-5 py-4">
            <p className="eyebrow">Étape 1</p>
            <h2 className="font-display text-xl font-medium text-ink">Sélectionner une écriture</h2>
            <p className="mt-1 text-xs text-ink-mute">
              Coller l&apos;UUID d&apos;une{' '}
              <code className="rounded-sm bg-sunk px-1.5 py-0.5 font-mono text-[11px] text-ink-soft">
                journal_entry
              </code>{' '}
              validée. L&apos;UUID est visible sur{' '}
              <Link href="/journals" className="text-accent-ink underline-offset-2 hover:underline">
                /journals
              </Link>{' '}
              dans le panneau détail.
            </p>
          </header>
          <form
            className="grid grid-cols-1 gap-3 p-5 md:grid-cols-[1fr_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setActiveEntryId(entryIdInput.trim());
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="eid">UUID écriture</Label>
              <Input
                id="eid"
                value={entryIdInput}
                onChange={(e) => setEntryIdInput(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="font-mono text-xs"
                required
              />
            </div>
            <Button type="submit" className="press">
              <Search className="mr-2 h-4 w-4" />
              Charger l&apos;écriture
            </Button>
          </form>
        </section>

        {activeEntryId ? (
          <EntryTransformPanel orgId={orgId} entryId={activeEntryId} />
        ) : (
          <section className="rounded-sm border border-dashed border-line bg-paper">
            <EmptyState
              icon={ArrowRightLeft}
              title="Aucune transformation"
              description="Chargez une écriture pour visualiser son historique et déclencher un reclassement ou un ajustement."
              actionLabel="Voir les journaux"
              actionHref="/journals"
            />
          </section>
        )}
      </div>
    </AppShell>
  );
}

function EntryTransformPanel({
  orgId,
  entryId,
}: {
  orgId: string;
  entryId: string;
}){
  const historyQuery = useQuery<
    { history: ReadonlyArray<TransformationHistoryEntry> },
    ApiError
  >({
    queryKey: ['transformation-history', orgId, entryId],
    queryFn: async () =>
      api.get(`/organizations/${orgId}/transformations/entries/${entryId}/history`),
  });

  // Reclassify form
  const [rcLineId, setRcLineId] = useState('');
  const [rcNewAccount, setRcNewAccount] = useState('');
  const [rcNotes, setRcNotes] = useState('');

  const reclassify = useApiMutation(
    async () =>
      api.post(`/organizations/${orgId}/transformations/reclassify`, {
        sourceEntryId: entryId,
        sourceLineId: rcLineId.trim(),
        targetAccountCode: rcNewAccount.trim(),
        notes: rcNotes.trim() === '' ? null : rcNotes.trim(),
      }),
    {
      onSuccess: () => {
        setRcLineId('');
        setRcNewAccount('');
        setRcNotes('');
        void historyQuery.refetch();
      },
    },
  );

  // Adjust form
  const [adjLabel, setAdjLabel] = useState('');
  const [adjSide, setAdjSide] = useState<'debit' | 'credit'>('debit');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjNotes, setAdjNotes] = useState('');

  const adjust = useApiMutation(
    async () => {
      const body: Record<string, unknown> = {
        sourceEntryId: entryId,
        adjustmentLabel: adjLabel.trim(),
        notes: adjNotes.trim() === '' ? null : adjNotes.trim(),
      };
      if (adjSide === 'debit') body.adjustmentDebit = adjAmount.trim();
      else body.adjustmentCredit = adjAmount.trim();
      return api.post(`/organizations/${orgId}/transformations/adjust`, body);
    },
    {
      onSuccess: () => {
        setAdjLabel('');
        setAdjAmount('');
        setAdjNotes('');
        void historyQuery.refetch();
      },
    },
  );

  const history = historyQuery.data?.history ?? [];

  return (
    <div className="space-y-6">
      {/* Active entry banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-accent/40 bg-accent-soft/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-sm bg-canvas">
            <Sparkles className="h-3.5 w-3.5 text-accent-ink" strokeWidth={1.5} />
          </span>
          <div>
            <p className="eyebrow text-accent-ink">Écriture chargée</p>
            <p className="font-mono text-xs tabular-nums text-ink">{entryId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip tone="accent">{history.length} transformation(s)</StatusChip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Reclassify column */}
        <section className="overflow-hidden rounded-sm border border-line bg-paper">
          <header className="border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-info-soft">
                <ArrowRightLeft className="h-3.5 w-3.5 text-info-ink" strokeWidth={1.5} />
              </span>
              <div>
                <p className="eyebrow">Action</p>
                <h2 className="font-display text-base font-medium text-ink">Reclasser une ligne</h2>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-mute">
              Génère une contre-passation de la ligne source + une nouvelle ligne sur le compte
              cible.
            </p>
          </header>
          <form
            className="space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              reclassify.mutate(undefined);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="rc-line">UUID ligne source</Label>
              <Input
                id="rc-line"
                value={rcLineId}
                onChange={(e) => setRcLineId(e.target.value)}
                className="font-mono text-xs"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-acc">Compte cible</Label>
              <Input
                id="rc-acc"
                value={rcNewAccount}
                onChange={(e) => setRcNewAccount(e.target.value)}
                placeholder="62110"
                className="font-mono"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-notes">Notes</Label>
              <Input
                id="rc-notes"
                value={rcNotes}
                onChange={(e) => setRcNotes(e.target.value)}
                placeholder="Motif du reclassement (facultatif)"
              />
            </div>
            <Button type="submit" disabled={reclassify.isPending} className="press w-full sm:w-auto">
              {reclassify.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="mr-2 h-4 w-4" />
              )}
              Reclasser
            </Button>
            <FormError error={reclassify.error} />
          </form>
        </section>

        {/* Adjust column */}
        <section className="overflow-hidden rounded-sm border border-line bg-paper">
          <header className="border-b border-line px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-sm bg-warn-soft">
                <Plus className="h-3.5 w-3.5 text-warn-ink" strokeWidth={1.5} />
              </span>
              <div>
                <p className="eyebrow">Action</p>
                <h2 className="font-display text-base font-medium text-ink">Ajustement</h2>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-mute">
              Ajoute une ligne complémentaire (débit OU crédit) à l&apos;écriture.
            </p>
          </header>
          <form
            className="space-y-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              adjust.mutate(undefined);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="adj-lbl">Libellé</Label>
              <Input
                id="adj-lbl"
                value={adjLabel}
                onChange={(e) => setAdjLabel(e.target.value)}
                placeholder="Ajustement de provision"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="adj-side">Côté</Label>
                <select
                  id="adj-side"
                  value={adjSide}
                  onChange={(e) => setAdjSide(e.target.value as 'debit' | 'credit')}
                  className={SELECT_CLS}
                >
                  <option value="debit">Débit</option>
                  <option value="credit">Crédit</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-amt">Montant</Label>
                <Input
                  id="adj-amt"
                  type="number"
                  step="0.01"
                  min="0"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  className="font-mono tabular-nums"
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-notes">Notes</Label>
              <Input
                id="adj-notes"
                value={adjNotes}
                onChange={(e) => setAdjNotes(e.target.value)}
                placeholder="Justification (facultatif)"
              />
            </div>
            <Button type="submit" disabled={adjust.isPending} className="press w-full sm:w-auto">
              {adjust.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Appliquer l&apos;ajustement
            </Button>
            <FormError error={adjust.error} />
          </form>
        </section>
      </div>

      {/* History */}
      <section className="overflow-hidden rounded-sm border border-line bg-paper">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-ink-mute" strokeWidth={1.5} />
            <div>
              <p className="eyebrow">Journal</p>
              <h2 className="font-display text-base font-medium text-ink">
                Historique des transformations
              </h2>
            </div>
          </div>
          <span className="font-mono text-xs tabular-nums text-ink-mute">{history.length}</span>
        </header>
        {historyQuery.isLoading ? (
          <SkeletonRows n={3} />
        ) : history.length === 0 ? (
          <EmptyState
            icon={History}
            title="Aucune transformation"
            description="Aucun retraitement n'a encore été appliqué à cette écriture. Lancez un reclassement ou un ajustement ci-dessus."
          />
        ) : (
          <ol className="divide-y divide-line">
            {history.map((h, idx) => (
              <li key={h.id} className="px-5 py-4">
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-canvas font-mono text-[11px] tabular-nums text-ink-soft">
                      {history.length - idx}
                    </span>
                    {idx < history.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-line" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusChip tone={h.type === 'reclassify' ? 'info' : 'warn'}>
                        {h.type === 'reclassify' ? (
                          <>
                            <ArrowRightLeft className="h-3 w-3" /> Reclassement
                          </>
                        ) : (
                          <>
                            <Plus className="h-3 w-3" /> Ajustement
                          </>
                        )}
                      </StatusChip>
                      <StatusChip tone="accent">
                        <CheckCircle2 className="h-3 w-3" /> Appliqué
                      </StatusChip>
                      <span className="font-mono text-[11px] tabular-nums text-ink-mute">
                        {new Date(h.createdAt).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    {h.notes && (
                      <p className="mt-2 text-xs leading-relaxed text-ink-soft">{h.notes}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        <FormError error={historyQuery.error} className="mx-5 mb-3" />
      </section>
    </div>
  );
}
