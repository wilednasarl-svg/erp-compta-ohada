'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FormError } from '@/components/ui/form-error';
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

/**
 * `/journals` — gestion des écritures comptables (Module 8).
 *
 * UX MVP :
 *   - barre de filtres (journal + statut) en haut,
 *   - liste paginée des écritures à gauche,
 *   - panneau détail à droite quand une écriture est sélectionnée
 *     (lignes débit/crédit + actions valider / contre-passer / supprimer),
 *   - formulaire de création en bas, dépliable.
 *
 * Comme la page Imports : pas de gating client par rôle — un user
 * sans `journals.write` recevra FORBIDDEN_PERMISSION à la soumission,
 * remonté inline. Visible-but-failable > invisible-and-confusing.
 */
export default function JournalsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const queryClient = useQueryClient();

  // ─── Filtres ────────────────────────────────────────────────────────
  const [filterJournalId, setFilterJournalId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<JournalEntryStatus | ''>('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // ─── Données ────────────────────────────────────────────────────────
  const journalsQuery = useQuery<ReadonlyArray<JournalView>, ApiError>({
    queryKey: ['journals', orgId],
    queryFn: async () => {
      const data = await api.get<JournalsResponse>(`/organizations/${orgId}/journals`);
      return data.journals;
    },
    enabled: orgId !== '',
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

  // accountId → code map for resolving lines on the detail panel.
  const accountById = useMemo(() => {
    const m = new Map<string, AccountView>();
    for (const a of accountsQuery.data ?? []) m.set(a.id, a);
    return m;
  }, [accountsQuery.data]);

  // journalId → code map for the list (which only returns journalId).
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
    void queryClient.invalidateQueries({ queryKey: ['journals', orgId] }); // bumped next_entry_number
  };

  // ─── Sélection détail ───────────────────────────────────────────────
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

  // ─── Création ───────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Journaux & Écritures</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saisie, validation et contre-passation des écritures comptables. Un brouillon
            peut être supprimé ; une écriture validée est immuable et ne s&apos;annule que
            par contre-passation.
          </p>
        </header>

        {/* Filtres */}
        <Card>
          <CardHeader>
            <CardTitle>Filtres</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[200px_200px_1fr]">
              <div className="space-y-1">
                <Label htmlFor="filter-journal">Journal</Label>
                <select
                  id="filter-journal"
                  value={filterJournalId}
                  onChange={(e) => {
                    setFilterJournalId(e.target.value);
                    setPage(1);
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Tous</option>
                  <option value="draft">Brouillon</option>
                  <option value="validated">Validé</option>
                  <option value="cancelled">Contre-passé</option>
                </select>
              </div>
              <div className="flex items-end justify-end">
                <Button
                  type="button"
                  variant={showCreate ? 'secondary' : 'default'}
                  onClick={() => setShowCreate((v) => !v)}
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
          </CardContent>
        </Card>

        {/* Création */}
        {showCreate && (
          <CreateEntryCard
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
          <Card>
            <CardHeader>
              <CardTitle>Écritures</CardTitle>
              <CardDescription>
                {entriesQuery.data?.total ?? 0} résultat(s) — page {page}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {entriesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Chargement…</p>
              ) : entriesQuery.data?.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucune écriture ne correspond aux filtres.
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {(entriesQuery.data?.entries ?? []).map((e) => {
                    const isSelected = e.id === selectedId;
                    const journal = journalById.get(e.journalId);
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(e.id)}
                          className={`flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60 ${
                            isSelected ? 'bg-muted/60' : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                {journal?.code ?? '?'} N°{e.entryNumber}
                              </span>
                              <EntryStatusBadge status={e.status} />
                            </div>
                            <div className="mt-0.5 truncate font-medium">{e.description}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
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

              {/* Pagination */}
              <div className="mt-3 flex items-center justify-between text-sm">
                <Button
                  type="button"
                  variant="outline"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Précédent
                </Button>
                <span className="text-muted-foreground">Page {page}</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={(entriesQuery.data?.entries.length ?? 0) < pageSize}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Suivant
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Détail */}
          {selectedId === null ? (
            <Card>
              <CardHeader>
                <CardTitle>Détail</CardTitle>
                <CardDescription>
                  Sélectionner une écriture pour voir ses lignes et agir dessus.
                </CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          ) : (
            <EntryDetailCard
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
const STATUS_VARIANT: Record<
  JournalEntryStatus,
  'default' | 'secondary' | 'muted' | 'destructive'
> = {
  draft: 'muted',
  validated: 'default',
  cancelled: 'destructive',
};

function EntryStatusBadge({ status }: { status: JournalEntryStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
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

function EntryDetailCard({ orgId, entryQuery, accountById, onClose, onMutated }: DetailProps) {
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
      <Card>
        <CardHeader>
          <CardTitle>Détail</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Chargement…
          </p>
          {entryQuery.error && <FormError error={entryQuery.error} className="mt-3" />}
        </CardContent>
      </Card>
    );
  }

  const totalDebit = entry.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = entry.lines.reduce((s, l) => s + Number(l.credit), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {entry.journalCode} N°{entry.entryNumber}
              <EntryStatusBadge status={entry.status} />
            </CardTitle>
            <CardDescription>
              {entry.entryDate} · {entry.description}
              {entry.reference ? ` · ${entry.reference}` : ''}
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Lignes */}
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Compte</th>
                <th className="px-3 py-2 text-left">Libellé</th>
                <th className="px-3 py-2 text-right">Débit</th>
                <th className="px-3 py-2 text-right">Crédit</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((l) => {
                const account = accountById.get(l.accountId);
                return (
                  <tr key={l.id} className="border-t">
                    <td className="px-3 py-2 text-muted-foreground">{l.position}</td>
                    <td className="px-3 py-2 font-mono">
                      {account ? `${account.code} — ${account.label}` : l.accountId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">{l.description ?? '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(l.debit) > 0 ? Number(l.debit).toFixed(2) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {Number(l.credit) > 0 ? Number(l.credit).toFixed(2) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t bg-muted/30 text-sm font-medium">
              <tr>
                <td className="px-3 py-2" colSpan={3}>
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
          <span className={balanced ? 'text-emerald-600' : 'text-destructive'}>
            {balanced ? 'OK' : `écart de ${(totalDebit - totalCredit).toFixed(2)}`}
          </span>
        </p>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {entry.status === 'draft' && (
            <>
              <Button
                type="button"
                onClick={() => validate.mutate(undefined)}
                disabled={validate.isPending || !balanced}
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
            <p className="text-sm text-muted-foreground">
              <Ban className="mr-1 inline h-4 w-4" />
              Écriture contre-passée — voir l&apos;écriture inverse créée lors de la
              contre-passation.
            </p>
          )}
        </div>
        <FormError error={validate.error} />
        <FormError error={cancel.error} />
        <FormError error={remove.error} />
      </CardContent>
    </Card>
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

function CreateEntryCard({ orgId, journals, onCreated }: CreateProps) {
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
      // Cast through unknown : `CreateEntryPayload` uses `readonly`
      // modifiers (no index signature) but the JSON body is shape-compatible.
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
    <Card>
      <CardHeader>
        <CardTitle>Nouvelle écriture</CardTitle>
        <CardDescription>
          Saisir l&apos;en-tête, puis au moins deux lignes équilibrées (Σ débit = Σ crédit).
          L&apos;écriture est créée en brouillon et peut être validée ensuite.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

          {/* Lignes */}
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Compte</th>
                  <th className="px-3 py-2 text-left">Libellé ligne</th>
                  <th className="px-3 py-2 text-right">Débit</th>
                  <th className="px-3 py-2 text-right">Crédit</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key} className="border-t">
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
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-muted/30 text-sm font-medium">
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
            <span className={balanced ? 'text-emerald-600' : 'text-destructive'}>
              {balanced
                ? 'OK'
                : totalDebit === 0
                  ? 'aucun montant saisi'
                  : `écart de ${(totalDebit - totalCredit).toFixed(2)}`}
            </span>
          </p>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={create.isPending || !balanced}>
              {create.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Créer en brouillon
            </Button>
            <span className="text-xs text-muted-foreground">
              Le bouton Valider apparaîtra dans le panneau détail.
            </span>
          </div>
          <FormError error={create.error} />
        </form>
      </CardContent>
    </Card>
  );
}
