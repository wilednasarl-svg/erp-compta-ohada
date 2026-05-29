'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Link2Off, Loader2, Wand2 } from 'lucide-react';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';

/* ─── Types ──────────────────────────────────────────────────── */

type LetteringStatus = 'open' | 'completed' | 'broken';

interface LetteringView {
  readonly id: string;
  readonly letteringCode: string;
  readonly partnerAccountCode: string;
  readonly partnerLabel: string;
  readonly totalAmount: string;
  readonly status: LetteringStatus;
  readonly lineIds: ReadonlyArray<string>;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly brokenAt: string | null;
  readonly brokenReason: string | null;
}

interface AutoLetterResult {
  readonly letteringsCreated: number;
  readonly linesLettered: number;
  readonly groupsConsidered: number;
  readonly skippedSingleton: number;
  readonly skippedUnbalanced: number;
  readonly skippedError: number;
}

const STATUS_LABEL: Record<LetteringStatus, string> = {
  open: 'Ouvert',
  completed: 'Soldé',
  broken: 'Dénoué',
};

/* Token-aligned status classes (no hardcoded Tailwind colors) */
const STATUS_CLASS: Record<LetteringStatus, string> = {
  open: 'bg-info-soft text-info-ink',
  completed: 'bg-accent-soft text-accent-ink',
  broken: 'bg-sunk text-ink-mute',
};

/* ─── Page ───────────────────────────────────────────────────── */

export default function LetteringPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();

  const [lineIdsText, setLineIdsText] = useState('');
  const [statusFilter, setStatusFilter] = useState<LetteringStatus | ''>('');

  const query = useQuery<ReadonlyArray<LetteringView>, ApiError>({
    queryKey: ['letterings', orgId, statusFilter],
    queryFn: async () => {
      const qs = statusFilter !== '' ? `?status=${statusFilter}` : '';
      const data = await api.get<{ letterings: ReadonlyArray<LetteringView> }>(
        `/organizations/${orgId}/letterings${qs}`,
      );
      return data.letterings;
    },
    enabled: orgId !== '',
  });

  const createMut = useApiMutation(async (ids: string[]) => {
    return api.post(`/organizations/${orgId}/letterings`, { journalEntryLineIds: ids });
  });

  const breakMut = useApiMutation(async (input: { id: string; reason: string }) => {
    return api.delete(`/organizations/${orgId}/letterings/${input.id}`, {
      body: { reason: input.reason },
    });
  });

  const autoMut = useApiMutation(async () => {
    const data = await api.post<{ result: AutoLetterResult }>(
      `/organizations/${orgId}/letterings/auto-by-invoice`,
      {},
    );
    return data.result;
  });

  async function handleAuto(): Promise<void> {
    await autoMut.mutateAsync(undefined);
    void qc.invalidateQueries({ queryKey: ['letterings'] });
  }

  function parseIds(text: string): string[] {
    return text
      .split(/[\s,\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  async function handleCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const ids = parseIds(lineIdsText);
    if (ids.length < 2) return;
    await createMut.mutateAsync(ids);
    setLineIdsText('');
    void qc.invalidateQueries({ queryKey: ['letterings'] });
  }

  async function handleBreak(id: string): Promise<void> {
    const reason = window.prompt('Motif du dénouement ?');
    if (!reason || reason.trim().length === 0) return;
    await breakMut.mutateAsync({ id, reason });
    void qc.invalidateQueries({ queryKey: ['letterings'] });
  }

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-12">
        {/* ─── Header ─────────────────────────────────────── */}
        <header>
          <p className="eyebrow mb-2">Tiers</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Lettrage
          </h1>
          <p className="mt-3 max-w-[64ch] text-sm leading-relaxed text-ink-soft">
            Réconciliation des comptes de tiers — créez un lettrage en sélectionnant des
            lignes d'écriture validées sur un même compte partenaire, débit = crédit.
          </p>
        </header>

        {/* ─── Auto-lettering by invoice ───────────────────── */}
        <section aria-labelledby="auto-lettering-title" className="space-y-4">
          <div className="border-b border-line pb-3">
            <h2 id="auto-lettering-title" className="font-display text-xl font-medium text-ink">
              Lettrage automatique
            </h2>
            <p className="mt-1 text-xs text-ink-mute">
              Rapproche en un clic les lignes de tiers non lettrées partageant le même N° de
              facture, lorsque la facture est totalement réglée (débit = crédit).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Button
              type="button"
              variant="secondary"
              className="press"
              disabled={autoMut.isPending || orgId === ''}
              onClick={() => void handleAuto()}
            >
              {autoMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Lettrer automatiquement par facture
            </Button>

            {autoMut.data !== undefined && (
              <p className="text-xs text-ink-soft">
                <span className="font-medium text-accent-ink">
                  {autoMut.data.letteringsCreated} lettrage
                  {autoMut.data.letteringsCreated !== 1 ? 's' : ''}
                </span>{' '}
                créé{autoMut.data.letteringsCreated !== 1 ? 's' : ''} (
                <span className="font-mono tabular-nums">{autoMut.data.linesLettered}</span>{' '}
                lignes) sur{' '}
                <span className="font-mono tabular-nums">{autoMut.data.groupsConsidered}</span>{' '}
                facture(s) — ignorées :{' '}
                <span className="font-mono tabular-nums">{autoMut.data.skippedUnbalanced}</span>{' '}
                non soldées,{' '}
                <span className="font-mono tabular-nums">{autoMut.data.skippedSingleton}</span>{' '}
                isolées.
              </p>
            )}
          </div>
          {autoMut.isError && <FormError error={autoMut.error} />}
        </section>

        {/* ─── New lettering form ──────────────────────────── */}
        <section aria-labelledby="new-lettering-title" className="space-y-5">
          <div className="border-b border-line pb-3">
            <h2 id="new-lettering-title" className="font-display text-xl font-medium text-ink">
              Nouveau lettrage
            </h2>
            <p className="mt-1 text-xs text-ink-mute">
              IDs des lignes d'écriture (minimum 2, séparés par espace, virgule ou retour
              à la ligne).
            </p>
          </div>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="line-ids">IDs des journal_entry_lines</Label>
              <textarea
                id="line-ids"
                className="w-full min-h-[80px] rounded-sm border border-line-strong bg-paper px-3 py-2 font-mono text-sm text-ink transition-colors focus:border-accent focus:outline-none"
                value={lineIdsText}
                onChange={(e) => setLineIdsText(e.target.value)}
                placeholder={"11111111-1111-...\n22222222-2222-..."}
              />
            </div>
            {createMut.isError && <FormError error={createMut.error} />}
            <Button
              type="submit"
              className="press"
              disabled={createMut.isPending || parseIds(lineIdsText).length < 2}
            >
              {createMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="mr-2 h-4 w-4" />
              )}
              Créer le lettrage
            </Button>
          </form>
        </section>

        {/* ─── Lettering list ──────────────────────────────── */}
        <section aria-labelledby="list-title" className="space-y-5">
          <div className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
            <div>
              <h2 id="list-title" className="font-display text-xl font-medium text-ink">
                Lettrages
              </h2>
              {query.data !== undefined && (
                <p className="mt-0.5 text-xs text-ink-mute">
                  {query.data.length} entrée{query.data.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
            <select
              className="rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as LetteringStatus | '')}
              aria-label="Filtrer par statut"
            >
              <option value="">Tous statuts</option>
              <option value="open">Ouverts</option>
              <option value="completed">Soldés</option>
              <option value="broken">Dénoués</option>
            </select>
          </div>

          {query.isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
              Chargement…
            </div>
          ) : (query.data?.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-sm text-ink-mute">Aucun lettrage.</p>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-sunk">
                    <th className="px-3 py-2.5 text-left"><span className="eyebrow">Code</span></th>
                    <th className="px-3 py-2.5 text-left"><span className="eyebrow">Compte</span></th>
                    <th className="px-3 py-2.5 text-left"><span className="eyebrow">Tiers</span></th>
                    <th className="px-3 py-2.5 text-right"><span className="eyebrow">Montant</span></th>
                    <th className="px-3 py-2.5 text-center"><span className="eyebrow">Lignes</span></th>
                    <th className="px-3 py-2.5 text-center"><span className="eyebrow">Statut</span></th>
                    <th className="px-3 py-2.5 text-right"><span className="eyebrow">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-line last:border-0 transition-colors duration-fast hover:bg-sunk/50"
                    >
                      <td className="px-3 py-2.5 font-mono text-xs text-ink">
                        {l.letteringCode}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-ink">
                        {l.partnerAccountCode}
                      </td>
                      <td className="px-3 py-2.5 text-ink-soft">{l.partnerLabel}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-ink">
                        {new Intl.NumberFormat('fr-FR').format(Number(l.totalAmount))}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono text-xs text-ink">
                        {l.lineIds.length}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={`inline-block rounded-xs px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[l.status]}`}
                        >
                          {STATUS_LABEL[l.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {l.status !== 'broken' && (
                          <button
                            type="button"
                            onClick={() => void handleBreak(l.id)}
                            disabled={breakMut.isPending}
                            className="press inline-flex h-7 w-7 items-center justify-center rounded-xs border border-line text-ink-mute transition-colors duration-fast hover:border-critical hover:text-critical-ink disabled:opacity-40"
                            title="Dénouer"
                          >
                            <Link2Off className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
