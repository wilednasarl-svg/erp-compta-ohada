'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  BookOpen,
  CheckCircle2,
  ChevronUp,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/form-error';
import { Hint } from '@/components/ui/hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountView } from '@/types/accounting-plan';
import type {
  CreateEntryLinePayload,
  CreateEntryPayload,
  EntryRow,
  EntryView,
  JournalEntryStatus,
  JournalKind,
  JournalView,
} from '@/types/journals';

interface EntriesListResponse {
  readonly entries: ReadonlyArray<EntryRow>;
  readonly total: number;
}
interface JournalsResponse {
  readonly journals: ReadonlyArray<JournalView>;
}
interface AccountsResponse {
  readonly accounts: ReadonlyArray<AccountView>;
}
interface EntryEnvelope {
  readonly entry: EntryView;
}

const SELECT_CLASS =
  'flex h-9 w-full rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink transition-colors focus:border-accent focus:outline-none';

const PANEL_CLASS = 'rounded-sm border border-line bg-paper p-5';

/**
 * `/journals` — gestion des écritures comptables (Module 8).
 */
export default function JournalsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();

  const [filterJournalId, setFilterJournalId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<JournalEntryStatus | ''>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const journalsQuery = useQuery<ReadonlyArray<JournalView>, ApiError>({
    queryKey: ['journals', orgId],
    queryFn: async () => {
      const data = await api.get<JournalsResponse>(`/organizations/${orgId}/journals`);
      return data.journals;
    },
    enabled: orgId !== '',
    // Toujours rafraîchir au montage : évite d'afficher « Aucun journal »
    // périmé alors qu'un journal a été créé entre-temps (incohérence
    // observée : liste vide mais création refusée « code déjà pris »).
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const accountsQuery = useQuery<ReadonlyArray<AccountView>, ApiError>({
    queryKey: ['chart-of-accounts', orgId],
    queryFn: async () => {
      const data = await api.get<AccountsResponse>(
        `/organizations/${orgId}/chart-of-accounts`,
      );
      return data.accounts;
    },
    enabled: orgId !== '',
  });

  const accountById = useMemo(() => {
    const m = new Map<string, AccountView>();
    for (const a of accountsQuery.data ?? []) m.set(a.id, a);
    return m;
  }, [accountsQuery.data]);

  const journalById = useMemo(() => {
    const m = new Map<string, JournalView>();
    for (const j of journalsQuery.data ?? []) m.set(j.id, j);
    return m;
  }, [journalsQuery.data]);

  const entriesQuery = useQuery<EntriesListResponse, ApiError>({
    queryKey: ['entries', orgId, filterJournalId, filterStatus, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterJournalId !== '') params.set('journalId', filterJournalId);
      if (filterStatus !== '') params.set('status', filterStatus);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      return api.get<EntriesListResponse>(
        `/organizations/${orgId}/entries?${params.toString()}`,
      );
    },
    enabled: orgId !== '',
  });

  const invalidateEntries = () => {
    void queryClient.invalidateQueries({ queryKey: ['entries', orgId] });
    void queryClient.invalidateQueries({ queryKey: ['journals', orgId] });
  };

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailQuery = useQuery<EntryView, ApiError>({
    queryKey: ['entry', orgId, selectedId],
    queryFn: async () => {
      const data = await api.get<EntryEnvelope>(
        `/organizations/${orgId}/entries/${selectedId!}`,
      );
      return data.entry;
    },
    enabled: orgId !== '' && selectedId !== null,
  });

  const [showCreate, setShowCreate] = useState(false);
  const [showJournals, setShowJournals] = useState(false);

  const hasNoJournals = !journalsQuery.isLoading && (journalsQuery.data ?? []).length === 0;

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        <header>
          <p className="eyebrow mb-2">Module 8 · Saisie</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
            Journaux &amp; Écritures
          </h1>
          <p className="mt-2 text-sm text-ink-mute">
            Saisie, validation et contre-passation des écritures comptables. Un brouillon
            peut être supprimé ; une écriture validée est immuable et ne s&apos;annule que
            par contre-passation.
          </p>
        </header>

        <Hint id="journals-intro" title="Comprendre les journaux">
          Chaque écriture est enregistrée dans un journal selon sa nature : ventes (JV),
          achats (JA), banque (BAN) ou opérations diverses (OD). Le journal regroupe les
          écritures de même type pour faciliter le suivi et le rapprochement.
        </Hint>

        {hasNoJournals ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent/25 bg-accent-soft/55 px-4 py-3">
            <p className="flex-1 text-sm text-accent-ink">
              <span className="font-semibold">Prochaine étape : </span>
              votre organisation n’a encore aucun journal. Créez les journaux standards
              SYSCOHADA (AC achats, VE ventes, BQ banque, CA caisse, OD divers, PA paie) pour
              pouvoir enregistrer des écritures.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => setShowJournals(true)}
              className="press shrink-0"
            >
              <BookOpen className="mr-2 h-4 w-4" />
              Gérer les journaux
            </Button>
          </div>
        ) : null}

        {/* Filtres */}
        <section className={PANEL_CLASS}>
          <div className="border-b border-line pb-3">
            <h2 className="font-display text-xl font-medium text-ink">Filtres</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 pt-4 md:grid-cols-[200px_200px_1fr]">
            <div className="space-y-1">
              <Label htmlFor="filter-journal">Journal</Label>
              <select
                id="filter-journal"
                value={filterJournalId}
                onChange={(e) => {
                  setFilterJournalId(e.target.value);
                  setPage(1);
                }}
                className={SELECT_CLASS}
              >
                <option value="">Tous</option>
                {(journalsQuery.data ?? []).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.code} — {j.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-status">Statut</Label>
              <select
                id="filter-status"
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value as JournalEntryStatus | '');
                  setPage(1);
                }}
                className={SELECT_CLASS}
              >
                <option value="">Tous</option>
                <option value="draft">Brouillon</option>
                <option value="validated">Validé</option>
                <option value="cancelled">Contre-passé</option>
              </select>
            </div>
            <div className="flex items-end justify-end gap-2">
              <Button
                type="button"
                variant={showJournals ? 'secondary' : 'outline'}
                onClick={() => setShowJournals((v) => !v)}
                className="press"
              >
                {showJournals ? (
                  <ChevronUp className="mr-2 h-4 w-4" />
                ) : (
                  <BookOpen className="mr-2 h-4 w-4" />
                )}
                {showJournals ? 'Masquer les journaux' : 'Gérer les journaux'}
              </Button>
              <Button
                type="button"
                variant={showCreate ? 'secondary' : 'default'}
                onClick={() => setShowCreate((v) => !v)}
                disabled={hasNoJournals}
                title={
                  hasNoJournals ? 'Créez d’abord un journal pour saisir une écriture.' : undefined
                }
                className="press"
              >
                {showCreate ? (
                  <ChevronUp className="mr-2 h-4 w-4" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {showCreate ? 'Masquer la saisie' : 'Nouvelle écriture'}
              </Button>
            </div>
          </div>
        </section>

        {/* Gestion des journaux */}
        {showJournals && (
          <ManageJournalsSection
            orgId={orgId}
            journals={journalsQuery.data ?? []}
            isLoading={journalsQuery.isLoading}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ['journals', orgId] });
            }}
          />
        )}

        {/* Création */}
        {showCreate && (
          <CreateEntrySection
            orgId={orgId}
            journals={journalsQuery.data ?? []}
            onCreated={() => {
              invalidateEntries();
              setShowCreate(false);
            }}
          />
        )}

        {/* Liste + détail */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_2fr]">
          <section className={PANEL_CLASS}>
            <div className="border-b border-line pb-3">
              <h2 className="font-display text-xl font-medium text-ink">Écritures</h2>
              <p className="mt-1 text-sm text-ink-mute">
                {entriesQuery.data?.total ?? 0} résultat(s) — page {page}
              </p>
            </div>
            <div className="pt-4">
              {entriesQuery.isLoading ? (
                <div className="overflow-hidden rounded-sm border border-line" aria-hidden>
                  {Array.from({ length: 6 }).map((_, r) => (
                    <div
                      key={r}
                      className="flex items-center gap-4 border-b border-line px-3 py-2.5 last:border-0"
                    >
                      <div className="h-3.5 w-20 rounded-xs bg-sunk" />
                      <div className="h-3.5 flex-1 rounded-xs bg-sunk" />
                      <div className="h-3.5 w-16 rounded-xs bg-sunk" />
                    </div>
                  ))}
                </div>
              ) : entriesQuery.data?.entries.length === 0 ? (
                <p className="text-sm text-ink-mute">
                  Aucune écriture ne correspond aux filtres.
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-sm border border-line">
                  {(entriesQuery.data?.entries ?? []).map((e) => {
                    const isSelected = e.id === selectedId;
                    const journal = journalById.get(e.journalId);
                    return (
                      <li key={e.id} className="card-lift">
                        <button
                          type="button"
                          onClick={() => setSelectedId(e.id)}
                          className={`press flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-sunk/60 ${
                            isSelected ? 'bg-sunk/60' : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-ink-mute">
                                {journal?.code ?? '?'} N°{e.entryNumber}
                              </span>
                              <EntryStatusBadge status={e.status} />
                            </div>
                            <div className="mt-0.5 truncate font-medium text-ink">
                              {e.description}
                            </div>
                            <div className="mt-0.5 text-xs text-ink-mute">
                              {e.entryDate}
                              {e.reference ? ` · ${e.reference}` : ''}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <FormError error={entriesQuery.error} className="mt-3" />

              <div className="mt-3 flex items-center justify-between text-sm">
                <Button
                  type="button"
                  variant="outline"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="press"
                >
                  Précédent
                </Button>
                <span className="text-ink-mute">Page {page}</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={(entriesQuery.data?.entries.length ?? 0) < pageSize}
                  onClick={() => setPage((p) => p + 1)}
                  className="press"
                >
                  Suivant
                </Button>
              </div>
            </div>
          </section>

          {/* Détail */}
          {selectedId === null ? (
            <section className={PANEL_CLASS}>
              <div className="border-b border-line pb-3">
                <h2 className="font-display text-xl font-medium text-ink">Détail</h2>
                <p className="mt-1 text-sm text-ink-mute">
                  Sélectionner une écriture pour voir ses lignes et agir dessus.
                </p>
              </div>
            </section>
          ) : (
            <EntryDetailSection
              orgId={orgId}
              entryQuery={detailQuery}
              accountById={accountById}
              onClose={() => setSelectedId(null)}
              onMutated={invalidateEntries}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Badges
// ─────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<JournalEntryStatus, string> = {
  draft: 'Brouillon',
  validated: 'Validé',
  cancelled: 'Contre-passé',
};

function EntryStatusBadge({ status }: { status: JournalEntryStatus }) {
  const cls =
    status === 'validated'
      ? 'bg-accent-soft text-accent-ink'
      : status === 'cancelled'
        ? 'bg-critical-soft text-critical-ink'
        : 'bg-sunk text-ink-soft';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Détail d'une écriture
// ─────────────────────────────────────────────────────────────────────

interface DetailProps {
  readonly orgId: string;
  readonly entryQuery: ReturnType<typeof useQuery<EntryView, ApiError>>;
  readonly accountById: Map<string, AccountView>;
  readonly onClose: () => void;
  readonly onMutated: () => void;
}

function EntryDetailSection({ orgId, entryQuery, accountById, onClose, onMutated }: DetailProps) {
  const entry = entryQuery.data;
  const [cancelReason, setCancelReason] = useState('');

  const validate = useApiMutation(
    async () => {
      if (!entry) throw new ApiError(404, { code: 'JOURNAL_ENTRY_NOT_FOUND', message: 'no entry' });
      await api.post(`/organizations/${orgId}/entries/${entry.id}/validate`, {});
    },
    { onSuccess: onMutated },
  );

  const cancel = useApiMutation(
    async () => {
      if (!entry) throw new ApiError(404, { code: 'JOURNAL_ENTRY_NOT_FOUND', message: 'no entry' });
      await api.post(`/organizations/${orgId}/entries/${entry.id}/cancel`, {
        reason: cancelReason.trim(),
      });
    },
    {
      onSuccess: () => {
        setCancelReason('');
        onMutated();
      },
    },
  );

  const remove = useApiMutation(
    async () => {
      if (!entry) throw new ApiError(404, { code: 'JOURNAL_ENTRY_NOT_FOUND', message: 'no entry' });
      await api.delete(`/organizations/${orgId}/entries/${entry.id}`);
    },
    {
      onSuccess: () => {
        onMutated();
        onClose();
      },
    },
  );

  if (entryQuery.isLoading || !entry) {
    return (
      <section className={PANEL_CLASS}>
        <div className="border-b border-line pb-3">
          <h2 className="font-display text-xl font-medium text-ink">Détail</h2>
        </div>
        <div className="pt-4">
          <p className="text-sm text-ink-mute">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Chargement…
          </p>
          {entryQuery.error && <FormError error={entryQuery.error} className="mt-3" />}
        </div>
      </section>
    );
  }

  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-medium text-ink">
              {entry.journalCode} N°{entry.entryNumber}
              <EntryStatusBadge status={entry.status} />
            </h2>
            <p className="mt-1 text-sm text-ink-mute">
              {entry.entryDate} · {entry.description}
              {entry.reference ? ` · ${entry.reference}` : ''}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="press">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="space-y-5 pt-4">
        <div className="overflow-x-auto rounded-sm border border-line">
          <table className="w-full text-sm">
            <thead className="bg-sunk">
              <tr>
                <th className="px-3 py-2 text-left">
                  <span className="eyebrow">#</span>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="eyebrow">Compte</span>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="eyebrow">Libellé</span>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="eyebrow">Facture</span>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="eyebrow">Échéance</span>
                </th>
                <th className="px-3 py-2 text-left">
                  <span className="eyebrow">Taxe</span>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="eyebrow">Débit</span>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="eyebrow">Crédit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((l) => {
                const account = accountById.get(l.accountId);
                return (
                  <tr
                    key={l.id}
                    className="border-t border-line transition-colors duration-fast hover:bg-sunk/50"
                  >
                    <td className="px-3 py-2 text-ink-mute">{l.position}</td>
                    <td className="px-3 py-2 font-mono text-ink">
                      {account ? `${account.code} — ${account.label}` : l.accountId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-ink">
                      {l.description ?? '—'}
                      {l.reference ? (
                        <span className="ml-2 text-2xs text-ink-mute">réf. {l.reference}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-soft">
                      {l.invoiceNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs tabular-nums text-ink-soft">
                      {l.dueDate ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-soft">
                      {l.taxCode ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {Number(l.debit) > 0 ? Number(l.debit).toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {Number(l.credit) > 0 ? Number(l.credit).toFixed(2) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-line bg-sunk/40 text-sm font-medium text-ink">
              <tr>
                <td className="px-3 py-2" colSpan={6}>
                  Totaux
                </td>
                <td className="px-3 py-2 text-right font-mono">{totalDebit.toFixed(2)}</td>
                <td className="px-3 py-2 text-right font-mono">{totalCredit.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-xs">
          Équilibre :{' '}
          <span className={balanced ? 'text-accent-ink' : 'text-critical-ink'}>
            {balanced ? 'OK' : `écart de ${(totalDebit - totalCredit).toFixed(2)}`}
          </span>
        </p>

        <div className="flex flex-wrap gap-2">
          {entry.status === 'draft' && (
            <>
              <Button
                type="button"
                onClick={() => validate.mutate(undefined)}
                disabled={validate.isPending || !balanced}
                className="press"
              >
                {validate.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Valider
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => remove.mutate(undefined)}
                disabled={remove.isPending}
                className="press"
              >
                {remove.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Supprimer
              </Button>
            </>
          )}
          {entry.status === 'validated' && (
            <div className="flex w-full flex-col gap-2 md:flex-row md:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="cancel-reason">Motif de la contre-passation</Label>
                <Input
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Ex. erreur de saisie facture FAC-001"
                  maxLength={500}
                />
              </div>
              <Button
                type="button"
                variant="destructive"
                disabled={cancel.isPending || cancelReason.trim().length === 0}
                onClick={() => cancel.mutate(undefined)}
                className="press"
              >
                {cancel.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Contre-passer
              </Button>
            </div>
          )}
          {entry.status === 'cancelled' && (
            <p className="text-sm text-ink-mute">
              <Ban className="mr-1 inline h-4 w-4" />
              Écriture contre-passée — voir l&apos;écriture inverse créée lors de la
              contre-passation.
            </p>
          )}
        </div>
        <FormError error={validate.error} />
        <FormError error={cancel.error} />
        <FormError error={remove.error} />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Formulaire de création
// ─────────────────────────────────────────────────────────────────────

interface CreateProps {
  readonly orgId: string;
  readonly journals: ReadonlyArray<JournalView>;
  readonly onCreated: () => void;
}

interface DraftLine {
  readonly key: string;
  accountCode: string;
  debit: string;
  credit: string;
  description: string;
}

const newLine = (): DraftLine => ({
  key: Math.random().toString(36).slice(2),
  accountCode: '',
  debit: '',
  credit: '',
  description: '',
});

function CreateEntrySection({ orgId, journals, onCreated }: CreateProps) {
  const [journalCode, setJournalCode] = useState<string>(journals[0]?.code ?? '');
  const [entryDate, setEntryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<ReadonlyArray<DraftLine>>([newLine(), newLine()]);

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || '0'), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || '0'), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  const updateLine = (key: string, patch: Partial<Omit<DraftLine, 'key'>>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const create = useApiMutation(
    async () => {
      const payload: CreateEntryPayload = {
        journalCode,
        entryDate,
        description: description.trim(),
        reference: reference.trim() === '' ? null : reference.trim(),
        lines: lines.map<CreateEntryLinePayload>((l) => ({
          accountCode: l.accountCode.trim(),
          debit: Number(l.debit || '0'),
          credit: Number(l.credit || '0'),
          description: l.description.trim() === '' ? null : l.description.trim(),
        })),
      };
      return api.post<EntryEnvelope>(
        `/organizations/${orgId}/entries`,
        payload as unknown as Record<string, unknown>,
      );
    },
    {
      onSuccess: () => {
        setDescription('');
        setReference('');
        setLines([newLine(), newLine()]);
        onCreated();
      },
    },
  );

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">Nouvelle écriture</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Saisir l&apos;en-tête, puis au moins deux lignes équilibrées (Σ débit = Σ crédit).
          L&apos;écriture est créée en brouillon et peut être validée ensuite.
        </p>
      </div>
      <div className="pt-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="new-journal">Journal</Label>
              <select
                id="new-journal"
                value={journalCode}
                onChange={(e) => setJournalCode(e.target.value)}
                required
                className={SELECT_CLASS}
              >
                {journals.map((j) => (
                  <option key={j.id} value={j.code}>
                    {j.code} — {j.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-date">Date</Label>
              <Input
                id="new-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="new-desc">Libellé</Label>
              <Input
                id="new-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex. Facture client FAC-001"
                maxLength={500}
                required
              />
            </div>
            <div className="space-y-1 md:col-span-4">
              <Label htmlFor="new-ref">Référence externe (optionnel)</Label>
              <Input
                id="new-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Ex. FAC-001"
                maxLength={200}
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-sm border border-line">
            <table className="w-full text-sm">
              <thead className="bg-sunk">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <span className="eyebrow">Compte</span>
                  </th>
                  <th className="px-3 py-2 text-left">
                    <span className="eyebrow">Libellé ligne</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <span className="eyebrow">Débit</span>
                  </th>
                  <th className="px-3 py-2 text-right">
                    <span className="eyebrow">Crédit</span>
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.key}
                    className="border-t border-line transition-colors duration-fast hover:bg-sunk/50"
                  >
                    <td className="px-2 py-1.5">
                      <Input
                        value={l.accountCode}
                        onChange={(e) => updateLine(l.key, { accountCode: e.target.value })}
                        placeholder="4111"
                        className="h-8"
                        required
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        value={l.description}
                        onChange={(e) => updateLine(l.key, { description: e.target.value })}
                        className="h-8"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.debit}
                        onChange={(e) => updateLine(l.key, { debit: e.target.value })}
                        className="h-8 text-right font-mono"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={l.credit}
                        onChange={(e) => updateLine(l.key, { credit: e.target.value })}
                        className="h-8 text-right font-mono"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={lines.length <= 2}
                        onClick={() =>
                          setLines((prev) => prev.filter((x) => x.key !== l.key))
                        }
                        className="press"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-sunk/40 text-sm font-medium text-ink">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>
                    Totaux
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{totalDebit.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-mono">{totalCredit.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLines((prev) => [...prev, newLine()])}
                      className="press"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs">
            Équilibre :{' '}
            <span className={balanced ? 'text-accent-ink' : 'text-critical-ink'}>
              {balanced
                ? 'OK'
                : totalDebit === 0
                  ? 'aucun montant saisi'
                  : `écart de ${(totalDebit - totalCredit).toFixed(2)}`}
            </span>
          </p>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={create.isPending || !balanced} className="press">
              {create.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Créer en brouillon
            </Button>
            <span className="text-xs text-ink-mute">
              Le bouton Valider apparaîtra dans le panneau détail.
            </span>
          </div>
          <FormError error={create.error} />
        </form>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Gestion des journaux
// ─────────────────────────────────────────────────────────────────────

interface StandardJournalSeed {
  readonly code: string;
  readonly label: string;
  readonly kind: JournalKind;
}

/** Miroir de `STANDARD_JOURNALS` (backend journal.types.ts). */
const STANDARD_JOURNAL_SEEDS: ReadonlyArray<StandardJournalSeed> = [
  { code: 'AC', label: 'Journal des Achats', kind: 'AC' },
  { code: 'VE', label: 'Journal des Ventes', kind: 'VE' },
  { code: 'BQ', label: 'Journal de Banque', kind: 'BQ' },
  { code: 'CA', label: 'Journal de Caisse', kind: 'CA' },
  { code: 'OD', label: 'Journal des Opérations Diverses', kind: 'OD' },
  { code: 'PA', label: 'Journal de Paie', kind: 'PA' },
];

const KIND_OPTIONS: ReadonlyArray<{ value: JournalKind; label: string }> = [
  { value: 'AC', label: 'Achats' },
  { value: 'VE', label: 'Ventes' },
  { value: 'BQ', label: 'Banque' },
  { value: 'CA', label: 'Caisse' },
  { value: 'OD', label: 'Opérations diverses' },
  { value: 'PA', label: 'Paie' },
];

const JOURNAL_CODE_PATTERN = '^[A-Z0-9-]{1,8}$';

interface ManageJournalsProps {
  readonly orgId: string;
  readonly journals: ReadonlyArray<JournalView>;
  readonly isLoading: boolean;
  readonly onChanged: () => void;
}

function ManageJournalsSection({ orgId, journals, isLoading, onChanged }: ManageJournalsProps) {
  const existingCodes = useMemo(() => new Set(journals.map((j) => j.code)), [journals]);
  const missingStandards = STANDARD_JOURNAL_SEEDS.filter((s) => !existingCodes.has(s.code));

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<JournalKind>('OD');

  const seedStandards = useApiMutation(
    async () => {
      // Création séquentielle des journaux standards manquants. Un code déjà
      // pris (JOURNAL_CODE_TAKEN) est ignoré pour rester idempotent.
      for (const j of missingStandards) {
        try {
          await api.post(`/organizations/${orgId}/journals`, {
            code: j.code,
            label: j.label,
            kind: j.kind,
          });
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'JOURNAL_CODE_TAKEN')) throw e;
        }
      }
    },
    { onSuccess: onChanged },
  );

  const createCustom = useApiMutation(
    async () => {
      await api.post(`/organizations/${orgId}/journals`, {
        code: code.trim().toUpperCase(),
        label: label.trim(),
        kind,
      });
    },
    {
      onSuccess: () => {
        setCode('');
        setLabel('');
        setKind('OD');
        onChanged();
      },
      onError: (err) => {
        // « Code déjà pris » alors que la liste paraît vide = liste périmée.
        // On la rafraîchit pour faire apparaître le journal existant.
        if (err.code === 'JOURNAL_CODE_TAKEN') {
          onChanged();
        }
      },
    },
  );

  return (
    <section className={PANEL_CLASS}>
      <div className="border-b border-line pb-3">
        <h2 className="font-display text-xl font-medium text-ink">Gérer les journaux</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Les journaux classent vos écritures par nature. Créez les journaux standards SYSCOHADA
          en un clic, ou ajoutez un journal personnalisé (ex. BQ-01, BQ-02 pour plusieurs banques).
        </p>
      </div>

      <div className="space-y-6 pt-4">
        {/* Liste des journaux existants */}
        <div>
          <h3 className="eyebrow mb-2">Journaux existants</h3>
          {isLoading ? (
            <p className="text-sm text-ink-mute">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
              Chargement…
            </p>
          ) : journals.length === 0 ? (
            <p className="text-sm text-ink-mute">Aucun journal pour le moment.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {journals.map((j) => (
                <li
                  key={j.id}
                  className="inline-flex items-center gap-2 rounded-sm border border-line bg-sunk/40 px-3 py-1.5 text-sm"
                >
                  <span className="font-mono font-medium text-ink">{j.code}</span>
                  <span className="text-ink-mute">{j.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Seed des journaux standards */}
        <div className="rounded-sm border border-line bg-sunk/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Journaux standards SYSCOHADA</p>
              <p className="mt-0.5 text-xs text-ink-mute">
                {missingStandards.length === 0
                  ? 'Tous les journaux standards sont déjà créés.'
                  : `${missingStandards.length} journal(aux) manquant(s) : ${missingStandards
                      .map((j) => j.code)
                      .join(', ')}.`}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => seedStandards.mutate(undefined)}
              disabled={seedStandards.isPending || missingStandards.length === 0}
              className="press"
            >
              {seedStandards.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BookOpen className="mr-2 h-4 w-4" />
              )}
              Créer les journaux standards
            </Button>
          </div>
          <FormError error={seedStandards.error} className="mt-3" />
        </div>

        {/* Journal personnalisé */}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createCustom.mutate(undefined);
          }}
        >
          <h3 className="eyebrow">Ajouter un journal personnalisé</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_1fr_200px]">
            <div className="space-y-1">
              <Label htmlFor="journal-code">Code</Label>
              <Input
                id="journal-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="BQ-01"
                pattern={JOURNAL_CODE_PATTERN}
                title="1 à 8 caractères : lettres majuscules, chiffres ou tirets."
                maxLength={8}
                required
                className="font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="journal-label">Libellé</Label>
              <Input
                id="journal-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex. Banque BICICI"
                maxLength={120}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="journal-kind">Nature</Label>
              <select
                id="journal-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as JournalKind)}
                className={SELECT_CLASS}
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button
            type="submit"
            disabled={createCustom.isPending || code.trim() === '' || label.trim() === ''}
            className="press"
          >
            {createCustom.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Ajouter le journal
          </Button>
          <FormError error={createCustom.error} />
        </form>
      </div>
    </section>
  );
}
