'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, FileUp, Layers, Link2, Loader2, Plus } from 'lucide-react';
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

interface BankAccount {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly bankName: string;
  readonly currency: string;
  readonly openingBalance: string;
  readonly status: 'active' | 'closed';
}

interface BankStatement {
  readonly id: string;
  readonly bankAccountId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly openingBalance: string;
  readonly closingBalance: string;
  readonly lineCount: number;
  readonly importedAt: string;
}

interface StatementLine {
  readonly id: string;
  readonly transactionDate: string;
  readonly valueDate: string | null;
  readonly description: string;
  readonly amount: string;
  readonly direction: 'debit' | 'credit';
  readonly isMatched: boolean;
}

interface MatchProposal {
  readonly statementLineId: string;
  readonly description: string;
  readonly amount: string;
  readonly direction: 'debit' | 'credit';
  readonly transactionDate: string;
  readonly proposals: ReadonlyArray<{
    readonly journalEntryLineId: string;
    readonly score: number;
    readonly entryDate: string;
    readonly entryNumber: number;
    readonly journalCode: string;
    readonly description: string;
    readonly debit: string;
    readonly credit: string;
  }>;
}

export default function BankReconciliationPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';
  const qc = useQueryClient();
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [importing, setImporting] = useState(false);

  const accountsQuery = useQuery<ReadonlyArray<BankAccount>, ApiError>({
    queryKey: ['bank-accounts', orgId],
    queryFn: async () => {
      const data = await api.get<{ bankAccounts: ReadonlyArray<BankAccount> }>(
        `/organizations/${orgId}/bank-accounts`,
      );
      return data.bankAccounts;
    },
    enabled: orgId !== '',
  });

  const proposalsQuery = useQuery<ReadonlyArray<MatchProposal>, ApiError>({
    queryKey: ['bank-proposals', activeAccountId],
    queryFn: async () => {
      const data = await api.get<{ proposals: ReadonlyArray<MatchProposal> }>(
        `/organizations/${orgId}/bank-reconciliation/bank-accounts/${activeAccountId}/proposals`,
      );
      return data.proposals;
    },
    enabled: activeAccountId !== null,
  });

  const [multiLineEnabled, setMultiLineEnabled] = useState(false);
  const [amountTolerance, setAmountTolerance] = useState<string>('');
  const [selectedByLine, setSelectedByLine] = useState<Record<string, ReadonlyArray<string>>>({});

  const matchMut = useApiMutation(
    async (input: {
      statementLineId: string;
      journalEntryLineIds: ReadonlyArray<string>;
    }): Promise<{ matchGroupId: string | null; fxRateApplied: string | null }> => {
      const body: Record<string, unknown> = {
        journalEntryLineIds: input.journalEntryLineIds,
      };
      if (multiLineEnabled) body.enableMultiLine = true;
      const tol = Number(amountTolerance);
      if (amountTolerance !== '' && Number.isFinite(tol) && tol >= 0) {
        body.amountTolerance = tol;
      }
      return api.post<{ matchGroupId: string | null; fxRateApplied: string | null }>(
        `/organizations/${orgId}/bank-reconciliation/statement-lines/${input.statementLineId}/match`,
        body,
      );
    },
  );

  function toggleCandidate(statementLineId: string, entryLineId: string): void {
    setSelectedByLine((prev) => {
      const current = prev[statementLineId] ?? [];
      const next = current.includes(entryLineId)
        ? current.filter((id) => id !== entryLineId)
        : [...current, entryLineId];
      return { ...prev, [statementLineId]: next };
    });
  }

  const activeAccount = accountsQuery.data?.find((a) => a.id === activeAccountId) ?? null;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Rapprochement bancaire</h1>
            <p className="text-sm text-muted-foreground">
              Comptes bancaires + import CSV des relevés + matching auto/manuel des lignes.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setCreatingAccount((v) => !v)} variant="outline">
              {creatingAccount ? 'Annuler' : <><Plus className="mr-2 h-4 w-4" /> Compte bancaire</>}
            </Button>
            {activeAccountId !== null && (
              <Button onClick={() => setImporting((v) => !v)}>
                {importing ? 'Annuler' : <><FileUp className="mr-2 h-4 w-4" /> Importer un relevé</>}
              </Button>
            )}
          </div>
        </div>

        {creatingAccount && <CreateAccountForm orgId={orgId} onSuccess={() => { setCreatingAccount(false); void qc.invalidateQueries({ queryKey: ['bank-accounts'] }); }} />}

        {importing && activeAccountId && (
          <ImportStatementForm
            orgId={orgId}
            bankAccountId={activeAccountId}
            onSuccess={() => { setImporting(false); void qc.invalidateQueries({ queryKey: ['bank-proposals'] }); }}
          />
        )}

        <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comptes bancaires</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {accountsQuery.isLoading ? (
                <Loader2 className="inline h-4 w-4 animate-spin" />
              ) : accountsQuery.data?.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center">Aucun compte. Créez-en un.</div>
              ) : (
                accountsQuery.data?.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => setActiveAccountId(acc.id)}
                    className={`w-full text-left p-3 rounded-md border transition-colors hover:bg-accent ${activeAccountId === acc.id ? 'border-primary bg-accent' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <Banknote className="h-4 w-4 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{acc.code}</div>
                        <div className="text-xs text-muted-foreground truncate">{acc.label} · {acc.bankName}</div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Lignes de relevé à rapprocher</CardTitle>
              <CardDescription>
                Tri par score Jaro-Winkler (libellé) + écart date (≤ 5 j). Mode multi-lignes (1:N) optionnel.
              </CardDescription>
              {activeAccountId !== null && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={multiLineEnabled}
                      onChange={(e) => setMultiLineEnabled(e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                    <Layers className="h-3.5 w-3.5" />
                    Multi-lignes (1:N)
                  </label>
                  <label className="flex items-center gap-1.5">
                    Tolérance
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={amountTolerance}
                      onChange={(e) => setAmountTolerance(e.target.value)}
                      placeholder="0.01"
                      className="h-7 w-24 text-xs"
                    />
                  </label>
                  {activeAccount && activeAccount.currency !== 'XOF' && (
                    <Badge variant="outline">
                      Devise compte : {activeAccount.currency} (FX requis)
                    </Badge>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!activeAccountId ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Sélectionnez un compte.</div>
              ) : proposalsQuery.isLoading ? (
                <div className="py-8 text-center"><Loader2 className="inline h-4 w-4 animate-spin" /></div>
              ) : proposalsQuery.data?.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">Aucune ligne en attente.</div>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {proposalsQuery.data?.map((p) => (
                    <div key={p.statementLineId} className="border rounded-md p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{p.description}</div>
                          <div className="text-xs text-muted-foreground">{p.transactionDate}</div>
                        </div>
                        <div className={`text-sm font-mono ${p.direction === 'credit' ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {p.direction === 'credit' ? '+' : '-'}{new Intl.NumberFormat('fr-FR').format(Number(p.amount))}
                        </div>
                      </div>
                      {p.proposals.length === 0 ? (
                        <div className="text-xs text-muted-foreground italic">Aucune écriture candidate.</div>
                      ) : (
                        <div className="space-y-1">
                          {p.proposals.slice(0, 6).map((c) => {
                            const selected = selectedByLine[p.statementLineId] ?? [];
                            const isChecked = selected.includes(c.journalEntryLineId);
                            return (
                              <div key={c.journalEntryLineId} className="flex items-center justify-between gap-2 bg-muted/40 rounded px-2 py-1.5 text-xs">
                                {multiLineEnabled && (
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleCandidate(p.statementLineId, c.journalEntryLineId)}
                                    className="h-3.5 w-3.5"
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="truncate">
                                    <Badge className="mr-1" variant="outline">{c.journalCode}/{c.entryNumber}</Badge>
                                    {c.description}
                                  </div>
                                  <div className="text-muted-foreground">{c.entryDate} · score {(c.score * 100).toFixed(0)}%</div>
                                </div>
                                {!multiLineEnabled && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      void matchMut.mutateAsync({
                                        statementLineId: p.statementLineId,
                                        journalEntryLineIds: [c.journalEntryLineId],
                                      }).then((res) => {
                                        if (res?.matchGroupId) {
                                          // eslint-disable-next-line no-console
                                          console.info('Match group:', res.matchGroupId.slice(0, 6));
                                        }
                                        return qc.invalidateQueries({ queryKey: ['bank-proposals'] });
                                      });
                                    }}
                                    disabled={matchMut.isPending}
                                  >
                                    <Link2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                          {multiLineEnabled && (selectedByLine[p.statementLineId]?.length ?? 0) > 0 && (
                            <div className="flex items-center justify-between pt-1">
                              <div className="text-xs text-muted-foreground">
                                {selectedByLine[p.statementLineId]?.length} ligne(s) sélectionnée(s)
                              </div>
                              <Button
                                size="sm"
                                onClick={() => {
                                  const ids = selectedByLine[p.statementLineId] ?? [];
                                  void matchMut.mutateAsync({
                                    statementLineId: p.statementLineId,
                                    journalEntryLineIds: ids,
                                  }).then((res) => {
                                    if (res?.matchGroupId) {
                                      // eslint-disable-next-line no-console
                                      console.info('Match group:', res.matchGroupId.slice(0, 6), 'FX:', res.fxRateApplied ?? 'n/a');
                                    }
                                    setSelectedByLine((prev) => ({ ...prev, [p.statementLineId]: [] }));
                                    return qc.invalidateQueries({ queryKey: ['bank-proposals'] });
                                  });
                                }}
                                disabled={matchMut.isPending}
                              >
                                <Link2 className="mr-1 h-3.5 w-3.5" /> Rapprocher (groupe)
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function CreateAccountForm({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [bankName, setBankName] = useState('');
  const [chartAccountId, setChartAccountId] = useState('');
  const [currency, setCurrency] = useState('XOF');

  const mut = useApiMutation(async () => {
    return api.post(`/organizations/${orgId}/bank-accounts`, {
      code, label, bankName, chartAccountId, currency,
    });
  });

  async function handle(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await mut.mutateAsync(undefined);
    onSuccess();
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Nouveau compte bancaire</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handle} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="b-code">Code</Label><Input id="b-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BNQ-001" required /></div>
          <div className="space-y-1.5"><Label htmlFor="b-label">Libellé</Label><Input id="b-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Compte courant principal" required /></div>
          <div className="space-y-1.5"><Label htmlFor="b-bank">Banque</Label><Input id="b-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="BICICI" required /></div>
          <div className="space-y-1.5"><Label htmlFor="b-cur">Devise</Label><Input id="b-cur" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} required /></div>
          <div className="space-y-1.5 md:col-span-2"><Label htmlFor="b-cha">ID compte chart-of-accounts (521x)</Label><Input id="b-cha" value={chartAccountId} onChange={(e) => setChartAccountId(e.target.value)} placeholder="UUID" required /></div>
          {mut.isError && <div className="md:col-span-2"><FormError error={mut.error} /></div>}
          <div className="md:col-span-2"><Button type="submit" disabled={mut.isPending}>{mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Créer</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ImportStatementForm({ orgId, bankAccountId, onSuccess }: { orgId: string; bankAccountId: string; onSuccess: () => void }) {
  const [fileName, setFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [closingBalance, setClosingBalance] = useState('');

  const mut = useApiMutation(async () => {
    return api.post(
      `/organizations/${orgId}/bank-accounts/${bankAccountId}/statements/import`,
      { fileName, fileContent, periodStart, periodEnd, openingBalance, closingBalance },
    );
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:text/csv;base64,XXXX"
      const b64 = result.split(',')[1] ?? '';
      setFileContent(b64);
    };
    reader.readAsDataURL(file);
  }

  async function handle(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await mut.mutateAsync(undefined);
    onSuccess();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Importer un relevé CSV</CardTitle>
        <CardDescription>Wave 1 : encodage automatique en base64. Format attendu : date,libellé,montant.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handle} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="s-file">Fichier CSV</Label>
            <Input id="s-file" type="file" accept=".csv,text/csv" onChange={handleFile} required />
          </div>
          <div className="space-y-1.5"><Label htmlFor="s-start">Période début</Label><Input id="s-start" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="s-end">Période fin</Label><Input id="s-end" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="s-open">Solde d'ouverture</Label><Input id="s-open" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} placeholder="15000000.00" required /></div>
          <div className="space-y-1.5"><Label htmlFor="s-close">Solde de clôture</Label><Input id="s-close" value={closingBalance} onChange={(e) => setClosingBalance(e.target.value)} placeholder="12500000.00" required /></div>
          {mut.isError && <div className="md:col-span-2"><FormError error={mut.error} /></div>}
          <div className="md:col-span-2">
            <Button type="submit" disabled={mut.isPending || fileContent.length === 0}>
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Importer
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
