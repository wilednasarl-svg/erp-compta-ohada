'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowRightLeft, Loader2, Plus, Search } from 'lucide-react';
import { useState } from 'react';

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

interface TransformationHistoryEntry {
  readonly id: string;
  readonly type: 'reclassify' | 'adjust';
  readonly createdAt: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly notes: string | null;
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
export default function TransformationsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [entryIdInput, setEntryIdInput] = useState('');
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

  return (
    <AppShell>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Transformations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Retraitements comptables : reclassement (changer le compte d&apos;une ligne) et
            ajustement (ajouter un débit / crédit complémentaire). Les écritures sources
            restent intactes ; chaque retraitement est tracé.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Sélectionner une écriture</CardTitle>
            <CardDescription>
              Coller l&apos;UUID d&apos;une <code>journal_entry</code> validée. L&apos;UUID est
              visible sur /journals dans le panneau détail.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                setActiveEntryId(entryIdInput.trim());
              }}
            >
              <div className="space-y-1">
                <Label htmlFor="eid">UUID écriture</Label>
                <Input
                  id="eid"
                  value={entryIdInput}
                  onChange={(e) => setEntryIdInput(e.target.value)}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  required
                />
              </div>
              <Button type="submit">
                <Search className="mr-2 h-4 w-4" />
                Charger
              </Button>
            </form>
          </CardContent>
        </Card>

        {activeEntryId && (
          <EntryTransformPanel orgId={orgId} entryId={activeEntryId} />
        )}
      </div>
    </AppShell>
  );
}

function EntryTransformPanel({ orgId, entryId }: { orgId: string; entryId: string }) {
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

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>
            <ArrowRightLeft className="mr-2 inline h-4 w-4" />
            Reclasser une ligne
          </CardTitle>
          <CardDescription>
            Génère une contre-passation de la ligne source + une nouvelle ligne sur le compte
            cible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              reclassify.mutate(undefined);
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="rc-line">UUID ligne source</Label>
              <Input id="rc-line" value={rcLineId} onChange={(e) => setRcLineId(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-acc">Compte cible</Label>
              <Input
                id="rc-acc"
                value={rcNewAccount}
                onChange={(e) => setRcNewAccount(e.target.value)}
                placeholder="62110"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rc-notes">Notes</Label>
              <Input id="rc-notes" value={rcNotes} onChange={(e) => setRcNotes(e.target.value)} />
            </div>
            <Button type="submit" disabled={reclassify.isPending}>
              {reclassify.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="mr-2 h-4 w-4" />
              )}
              Reclasser
            </Button>
            <FormError error={reclassify.error} />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Plus className="mr-2 inline h-4 w-4" />
            Ajustement
          </CardTitle>
          <CardDescription>
            Ajoute une ligne complémentaire (débit OU crédit) à l&apos;écriture.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              adjust.mutate(undefined);
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="adj-lbl">Libellé</Label>
              <Input id="adj-lbl" value={adjLabel} onChange={(e) => setAdjLabel(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="adj-side">Côté</Label>
                <select
                  id="adj-side"
                  value={adjSide}
                  onChange={(e) => setAdjSide(e.target.value as 'debit' | 'credit')}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="debit">Débit</option>
                  <option value="credit">Crédit</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="adj-amt">Montant</Label>
                <Input
                  id="adj-amt"
                  type="number"
                  step="0.01"
                  min="0"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="adj-notes">Notes</Label>
              <Input id="adj-notes" value={adjNotes} onChange={(e) => setAdjNotes(e.target.value)} />
            </div>
            <Button type="submit" disabled={adjust.isPending}>
              {adjust.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Ajuster
            </Button>
            <FormError error={adjust.error} />
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Historique des transformations</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : (historyQuery.data?.history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune transformation appliquée.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(historyQuery.data?.history ?? []).map((h) => (
                <li key={h.id} className="rounded border p-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{h.type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.createdAt).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  {h.notes && <div className="mt-1 text-xs">{h.notes}</div>}
                </li>
              ))}
            </ul>
          )}
          <FormError error={historyQuery.error} className="mt-2" />
        </CardContent>
      </Card>
    </div>
  );
}
