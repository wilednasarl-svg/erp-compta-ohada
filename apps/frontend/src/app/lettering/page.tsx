'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
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

const STATUS_LABEL: Record<LetteringStatus, string> = {
  open: 'Ouvert',
  completed: 'Soldé',
  broken: 'Dénoué',
};

const STATUS_COLOR: Record<LetteringStatus, string> = {
  open: 'bg-blue-100 text-blue-900',
  completed: 'bg-emerald-100 text-emerald-900',
  broken: 'bg-slate-200 text-slate-700',
};

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
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Lettrage</h1>
          <p className="text-sm text-muted-foreground">
            Réconciliation des comptes de tiers — créez un lettrage en sélectionnant des lignes
            d'écriture validées sur un même compte partenaire, débit = crédit.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouveau lettrage</CardTitle>
            <CardDescription>
              IDs des lignes d'écriture (au moins 2, séparés par espace/virgule/retour).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="line-ids">IDs des journal_entry_lines</Label>
                <textarea
                  id="line-ids"
                  className="w-full min-h-[80px] rounded-md border bg-background px-3 py-2 text-sm font-mono"
                  value={lineIdsText}
                  onChange={(e) => setLineIdsText(e.target.value)}
                  placeholder="11111111-1111-...&#10;22222222-2222-..."
                />
              </div>
              {createMut.isError && <FormError error={createMut.error} />}
              <Button
                type="submit"
                disabled={createMut.isPending || parseIds(lineIdsText).length < 2}
              >
                {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                Créer le lettrage
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">Lettrages</CardTitle>
                <CardDescription>{query.data?.length ?? 0} entrées</CardDescription>
              </div>
              <select
                className="rounded-md border bg-background px-3 py-1.5 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as LetteringStatus | '')}
              >
                <option value="">Tous statuts</option>
                <option value="open">Ouverts</option>
                <option value="completed">Soldés</option>
                <option value="broken">Dénoués</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            {query.isLoading ? (
              <div className="py-8 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
            ) : query.data?.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">Aucun lettrage.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-muted-foreground">
                    <tr>
                      <th className="text-left py-2 px-2">Code</th>
                      <th className="text-left py-2 px-2">Compte</th>
                      <th className="text-left py-2 px-2">Tiers</th>
                      <th className="text-right py-2 px-2">Montant</th>
                      <th className="text-center py-2 px-2">Lignes</th>
                      <th className="text-center py-2 px-2">Statut</th>
                      <th className="text-right py-2 px-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data?.map((l) => (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="py-2 px-2 font-mono">{l.letteringCode}</td>
                        <td className="py-2 px-2 font-mono">{l.partnerAccountCode}</td>
                        <td className="py-2 px-2">{l.partnerLabel}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          {new Intl.NumberFormat('fr-FR').format(Number(l.totalAmount))}
                        </td>
                        <td className="py-2 px-2 text-center">{l.lineIds.length}</td>
                        <td className="py-2 px-2 text-center">
                          <Badge className={STATUS_COLOR[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                        </td>
                        <td className="py-2 px-2 text-right">
                          {l.status !== 'broken' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleBreak(l.id)}
                              disabled={breakMut.isPending}
                            >
                              <Link2Off className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
