'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  CheckCircle2,
  FileUp,
  Hash,
  Landmark,
  Layers,
  Link2,
  Loader2,
  Plus,
  Scale,
  Sparkles,
  Wallet,
  X,
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

interface BankAccount {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly bankName: string;
  readonly currency: string;
  readonly openingBalance: string;
  readonly status: 'active' | 'closed';
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

function formatAmount(value: string | number): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}

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

export default function BankReconciliationPage(){
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
  const [focusedLineId, setFocusedLineId] = useState<string | null>(null);

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
  const proposals = proposalsQuery.data ?? [];
  const focusedProposal = useMemo(
    () => proposals.find((p) => p.statementLineId === focusedLineId) ?? proposals[0] ?? null,
    [proposals, focusedLineId],
  );

  const totals = useMemo(() => {
    if (proposals.length === 0) {
      return { unreconciled: 0, credits: 0, debits: 0 };
    }
    return proposals.reduce(
      (acc, p) => {
        const amt = Number(p.amount);
        if (Number.isFinite(amt)) {
          if (p.direction === 'credit') acc.credits += amt;
          else acc.debits += amt;
        }
        acc.unreconciled += 1;
        return acc;
      },
      { unreconciled: 0, credits: 0, debits: 0 },
    );
  }, [proposals]);

  return (
    <AppShell>
      <div className="animate-page-in space-y-8">
        {/* Hero header */}
        <header className="flex flex-col gap-6 border-b border-line pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow mb-2">Retraitement · Rapprochement</p>
            <h1 className="font-display text-4xl font-medium tracking-tight text-ink">
              Rapprochement bancaire
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              Confronter les lignes de relevé bancaire aux écritures comptables. Le moteur de
              matching propose les candidats triés par similarité de libellé (Jaro-Winkler) et
              proximité de date, puis vous validez en un clic.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => setCreatingAccount((v) => !v)}
              variant="outline"
              className="press"
            >
              {creatingAccount ? (
                <>
                  <X className="mr-2 h-4 w-4" /> Annuler
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" /> Compte bancaire
                </>
              )}
            </Button>
            {activeAccountId !== null && (
              <Button onClick={() => setImporting((v) => !v)} className="press">
                {importing ? (
                  <>
                    <X className="mr-2 h-4 w-4" /> Annuler
                  </>
                ) : (
                  <>
                    <FileUp className="mr-2 h-4 w-4" /> Importer un relevé
                  </>
                )}
              </Button>
            )}
          </div>
        </header>

        {/* KPI strip when account active */}
        {activeAccount && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile
              icon={Landmark}
              label="Compte actif"
              value={activeAccount.code}
              detail={activeAccount.bankName}
            />
            <KpiTile
              icon={Wallet}
              label="Devise"
              value={activeAccount.currency}
              detail={
                activeAccount.currency !== 'XOF' ? 'Conversion FX appliquée' : 'Devise locale'
              }
            />
            <KpiTile
              icon={Scale}
              label="Lignes en attente"
              value={String(totals.unreconciled)}
              detail={totals.unreconciled === 0 ? 'À jour' : 'À pointer'}
              tone={totals.unreconciled === 0 ? 'accent' : 'warn'}
            />
            <KpiTile
              icon={Hash}
              label="Volume net"
              value={formatAmount(totals.credits - totals.debits)}
              detail={`+${formatAmount(totals.credits)} / -${formatAmount(totals.debits)}`}
              mono
            />
          </div>
        )}

        {creatingAccount && (
          <CreateAccountForm
            orgId={orgId}
            onSuccess={() => {
              setCreatingAccount(false);
              void qc.invalidateQueries({ queryKey: ['bank-accounts'] });
            }}
          />
        )}

        {importing && activeAccountId && (
          <ImportStatementForm
            orgId={orgId}
            bankAccountId={activeAccountId}
            onSuccess={() => {
              setImporting(false);
              void qc.invalidateQueries({ queryKey: ['bank-proposals'] });
            }}
          />
        )}

        {/* Two-column workspace */}
        <div className="grid gap-5 lg:grid-cols-[280px_1fr_1fr]">
          {/* Accounts sidebar */}
          <aside className="rounded-sm border border-line bg-paper">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <p className="eyebrow">Comptes</p>
                <h2 className="font-display text-base font-medium text-ink">Bancaires</h2>
              </div>
              <span className="font-mono text-xs tabular-nums text-ink-mute">
                {accountsQuery.data?.length ?? 0}
              </span>
            </header>
            <div className="p-2">
              {accountsQuery.isLoading ? (
                <div className="p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-ink-mute" />
                </div>
              ) : (accountsQuery.data ?? []).length === 0 ? (
                <EmptyState
                  icon={Banknote}
                  title="Aucun compte"
                  description="Créez un compte bancaire pour démarrer l'import des relevés."
                />
              ) : (
                <ul className="space-y-1">
                  {(accountsQuery.data ?? []).map((acc) => {
                    const isActive = activeAccountId === acc.id;
                    return (
                      <li key={acc.id}>
                        <button
                          onClick={() => setActiveAccountId(acc.id)}
                          className={`press group flex w-full items-start gap-3 rounded-sm border px-3 py-2.5 text-left transition-colors duration-fast ${
                            isActive
                              ? 'border-accent bg-accent-soft'
                              : 'border-transparent hover:bg-sunk/50'
                          }`}
                        >
                          <span
                            className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm ${
                              isActive ? 'bg-canvas text-accent-ink' : 'bg-sunk text-ink-mute'
                            }`}
                          >
                            <Banknote className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-medium tabular-nums text-ink">
                                {acc.code}
                              </span>
                              <span className="text-[10px] uppercase tracking-wide text-ink-mute">
                                {acc.currency}
                              </span>
                            </div>
                            <p className="truncate text-xs text-ink-soft">{acc.label}</p>
                            <p className="truncate text-[11px] text-ink-mute">{acc.bankName}</p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          {/* Statement lines column */}
          <section className="overflow-hidden rounded-sm border border-line bg-paper">
            <header className="border-b border-line px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="eyebrow">Relevé</p>
                  <h2 className="font-display text-base font-medium text-ink">
                    Lignes à pointer
                  </h2>
                </div>
                {activeAccountId !== null && proposals.length > 0 && (
                  <StatusChip tone="warn">
                    {proposals.length} en attente
                  </StatusChip>
                )}
              </div>
              {activeAccountId !== null && (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={multiLineEnabled}
                      onChange={(e) => setMultiLineEnabled(e.target.checked)}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                    <Layers className="h-3.5 w-3.5" />
                    Multi-lignes (1:N)
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span className="text-ink-mute">Tolérance</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={amountTolerance}
                      onChange={(e) => setAmountTolerance(e.target.value)}
                      placeholder="0.01"
                      className="h-7 w-20 text-xs"
                    />
                  </label>
                  {activeAccount && activeAccount.currency !== 'XOF' && (
                    <StatusChip tone="info">FX {activeAccount.currency}</StatusChip>
                  )}
                </div>
              )}
            </header>

            <div className="max-h-[640px] overflow-y-auto">
              {!activeAccountId ? (
                <EmptyState
                  icon={Banknote}
                  title="Sélectionnez un compte"
                  description="Choisissez un compte bancaire à gauche pour afficher les lignes à rapprocher."
                />
              ) : proposalsQuery.isLoading ? (
                <SkeletonRows n={5} />
              ) : proposals.length === 0 ? (
                <EmptyState
                  icon={Banknote}
                  title="Tout est à jour"
                  description="Aucune écriture en attente de rapprochement sur ce compte."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {proposals.map((p) => {
                    const isFocused =
                      focusedLineId === p.statementLineId ||
                      (focusedLineId === null && focusedProposal?.statementLineId === p.statementLineId);
                    const isCredit = p.direction === 'credit';
                    return (
                      <li key={p.statementLineId}>
                        <button
                          type="button"
                          onClick={() => setFocusedLineId(p.statementLineId)}
                          className={`press flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-fast ${
                            isFocused ? 'bg-accent-soft/40' : 'hover:bg-sunk/40'
                          }`}
                        >
                          <span
                            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                              isCredit ? 'bg-accent' : 'bg-critical'
                            }`}
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-3">
                              <p className="truncate text-sm font-medium text-ink">
                                {p.description}
                              </p>
                              <span
                                className={`shrink-0 font-mono text-sm font-medium tabular-nums ${
                                  isCredit ? 'text-accent-ink' : 'text-critical-ink'
                                }`}
                              >
                                {isCredit ? '+' : '−'}
                                {formatAmount(p.amount)}
                              </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="font-mono text-[11px] tabular-nums text-ink-mute">
                                {p.transactionDate}
                              </span>
                              <span className="text-ink-mute">·</span>
                              {p.proposals.length > 0 ? (
                                <StatusChip tone="warn">À pointer · {p.proposals.length} cand.</StatusChip>
                              ) : (
                                <StatusChip tone="critical">Sans candidat</StatusChip>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Candidates / matching column */}
          <section className="overflow-hidden rounded-sm border border-line bg-paper">
            <header className="border-b border-line px-4 py-3">
              <p className="eyebrow">Écritures</p>
              <h2 className="font-display text-base font-medium text-ink">Candidats</h2>
              <p className="mt-1 text-xs text-ink-mute">
                Tri par score Jaro-Winkler · écart date ≤ 5 j
              </p>
            </header>

            <div className="max-h-[640px] overflow-y-auto">
              {!activeAccountId || !focusedProposal ? (
                <EmptyState
                  icon={Sparkles}
                  title="Aucune ligne sélectionnée"
                  description="Cliquez sur une ligne du relevé pour voir les écritures candidates."
                />
              ) : focusedProposal.proposals.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="Aucun candidat"
                  description="Aucune écriture journal ne correspond à cette ligne. Créez-la manuellement si nécessaire."
                />
              ) : (
                <div className="space-y-3 p-4">
                  <FocusedLineHeader proposal={focusedProposal} />
                  <div className="space-y-2">
                    {focusedProposal.proposals.slice(0, 8).map((c) => {
                      const selected = selectedByLine[focusedProposal.statementLineId] ?? [];
                      const isChecked = selected.includes(c.journalEntryLineId);
                      const lineAmount =
                        Number(c.debit) > 0 ? Number(c.debit) : Number(c.credit);
                      const statementAmount = Number(focusedProposal.amount);
                      const diff = Math.abs(lineAmount - statementAmount);
                      return (
                        <article
                          key={c.journalEntryLineId}
                          className={`group rounded-sm border bg-paper p-3 transition-colors duration-fast ${
                            isChecked
                              ? 'border-accent bg-accent-soft/40'
                              : 'border-line hover:border-line-strong'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {multiLineEnabled && (
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() =>
                                  toggleCandidate(
                                    focusedProposal.statementLineId,
                                    c.journalEntryLineId,
                                  )
                                }
                                className="mt-1 h-4 w-4 shrink-0 accent-accent"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center rounded-sm border border-line-strong bg-sunk px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-ink">
                                  {c.journalCode}/{c.entryNumber}
                                </span>
                                <span className="font-mono text-[11px] tabular-nums text-ink-mute">
                                  {c.entryDate}
                                </span>
                                <ScoreBadge score={c.score} />
                              </div>
                              <p className="mt-1.5 text-sm text-ink">{c.description}</p>
                              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                                <span className="font-mono tabular-nums text-ink-soft">
                                  Débit {formatAmount(c.debit)}
                                </span>
                                <span className="font-mono tabular-nums text-ink-soft">
                                  Crédit {formatAmount(c.credit)}
                                </span>
                                {diff > 0.01 && (
                                  <span className="font-mono tabular-nums text-critical-ink">
                                    Δ {formatAmount(diff)}
                                  </span>
                                )}
                              </div>
                            </div>
                            {!multiLineEnabled && (
                              <Button
                                size="sm"
                                className="press shrink-0"
                                onClick={() => {
                                  void matchMut
                                    .mutateAsync({
                                      statementLineId: focusedProposal.statementLineId,
                                      journalEntryLineIds: [c.journalEntryLineId],
                                    })
                                    .then((res) => {
                                      if (res?.matchGroupId) {
                                        // eslint-disable-next-line no-console
                                        console.info('Match group:', res.matchGroupId.slice(0, 6));
                                      }
                                      return qc.invalidateQueries({
                                        queryKey: ['bank-proposals'],
                                      });
                                    });
                                }}
                                disabled={matchMut.isPending}
                              >
                                <Link2 className="mr-1 h-3.5 w-3.5" /> Pointer
                              </Button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {multiLineEnabled &&
                    (selectedByLine[focusedProposal.statementLineId]?.length ?? 0) > 0 && (
                      <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-ink-soft">
                            <span className="font-medium text-ink">
                              {selectedByLine[focusedProposal.statementLineId]?.length}
                            </span>{' '}
                            ligne(s) sélectionnée(s)
                          </div>
                          <Button
                            size="sm"
                            className="press"
                            onClick={() => {
                              const ids = selectedByLine[focusedProposal.statementLineId] ?? [];
                              void matchMut
                                .mutateAsync({
                                  statementLineId: focusedProposal.statementLineId,
                                  journalEntryLineIds: ids,
                                })
                                .then((res) => {
                                  if (res?.matchGroupId) {
                                    // eslint-disable-next-line no-console
                                    console.info(
                                      'Match group:',
                                      res.matchGroupId.slice(0, 6),
                                      'FX:',
                                      res.fxRateApplied ?? 'n/a',
                                    );
                                  }
                                  setSelectedByLine((prev) => ({
                                    ...prev,
                                    [focusedProposal.statementLineId]: [],
                                  }));
                                  return qc.invalidateQueries({
                                    queryKey: ['bank-proposals'],
                                  });
                                });
                            }}
                            disabled={matchMut.isPending}
                          >
                            <Link2 className="mr-1.5 h-3.5 w-3.5" /> Rapprocher en groupe
                          </Button>
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'neutral',
  mono = false,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'accent' | 'warn';
  mono?: boolean;
}){
  const toneClass: Record<typeof tone, string> = {
    neutral: 'text-ink-soft',
    accent: 'text-accent-ink',
    warn: 'text-warn-ink',
  };
  return (
    <div className="rounded-sm border border-line bg-paper p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-ink-mute" strokeWidth={1.5} />
        <p className="eyebrow">{label}</p>
      </div>
      <p
        className={`mt-2 text-2xl font-medium tracking-tight text-ink ${mono ? 'font-mono tabular-nums' : 'font-display'}`}
      >
        {value}
      </p>
      {detail && <p className={`mt-1 text-[11px] ${toneClass[tone]}`}>{detail}</p>}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }){
  const pct = Math.round(score * 100);
  const tone: 'accent' | 'warn' | 'critical' =
    pct >= 80 ? 'accent' : pct >= 50 ? 'warn' : 'critical';
  const cls: Record<typeof tone, string> = {
    accent: 'bg-accent-soft text-accent-ink',
    warn: 'bg-warn-soft text-warn-ink',
    critical: 'bg-critical-soft text-critical-ink',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${cls[tone]}`}
    >
      {pct}%
    </span>
  );
}

function FocusedLineHeader({ proposal }: { proposal: MatchProposal }){
  const isCredit = proposal.direction === 'credit';
  return (
    <div className="rounded-sm border border-line-strong bg-sunk/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Ligne ciblée</p>
          <p className="mt-1 truncate text-sm font-medium text-ink">{proposal.description}</p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-ink-mute">
            {proposal.transactionDate}
          </p>
        </div>
        <div
          className={`shrink-0 text-right font-mono text-base font-medium tabular-nums ${
            isCredit ? 'text-accent-ink' : 'text-critical-ink'
          }`}
        >
          {isCredit ? '+' : '−'}
          {formatAmount(proposal.amount)}
        </div>
      </div>
    </div>
  );
}

function CreateAccountForm({
  orgId,
  onSuccess,
}: {
  orgId: string;
  onSuccess: () => void;
}){
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [bankName, setBankName] = useState('');
  const [chartAccountId, setChartAccountId] = useState('');
  const [currency, setCurrency] = useState('XOF');

  const mut = useApiMutation(async () => {
    return api.post(`/organizations/${orgId}/bank-accounts`, {
      code,
      label,
      bankName,
      chartAccountId,
      currency,
    });
  });

  async function handle(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    await mut.mutateAsync(undefined);
    onSuccess();
  }

  return (
    <section className="overflow-hidden rounded-sm border border-line bg-paper">
      <header className="border-b border-line px-5 py-3">
        <p className="eyebrow">Création</p>
        <h2 className="font-display text-lg font-medium text-ink">Nouveau compte bancaire</h2>
      </header>
      <form onSubmit={handle} className="grid gap-4 p-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="b-code">Code</Label>
          <Input
            id="b-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="BNQ-001"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-label">Libellé</Label>
          <Input
            id="b-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Compte courant principal"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-bank">Banque</Label>
          <Input
            id="b-bank"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="BICICI"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-cur">Devise</Label>
          <Input
            id="b-cur"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="b-cha">ID compte chart-of-accounts (521x)</Label>
          <Input
            id="b-cha"
            value={chartAccountId}
            onChange={(e) => setChartAccountId(e.target.value)}
            placeholder="UUID"
            required
          />
        </div>
        {mut.isError && (
          <div className="md:col-span-2">
            <FormError error={mut.error} />
          </div>
        )}
        <div className="md:col-span-2">
          <Button type="submit" disabled={mut.isPending} className="press">
            {mut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            )}
            Créer le compte
          </Button>
        </div>
      </form>
    </section>
  );
}

function ImportStatementForm({
  orgId,
  bankAccountId,
  onSuccess,
}: {
  orgId: string;
  bankAccountId: string;
  onSuccess: () => void;
}){
  const [fileName, setFileName] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [closingBalance, setClosingBalance] = useState('');

  const mut = useApiMutation(async () => {
    return api.post(`/organizations/${orgId}/bank-accounts/${bankAccountId}/statements/import`, {
      fileName,
      fileContent,
      periodStart,
      periodEnd,
      openingBalance,
      closingBalance,
    });
  });

  function handleFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
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
    <section className="overflow-hidden rounded-sm border border-line bg-paper">
      <header className="border-b border-line px-5 py-3">
        <p className="eyebrow">Import</p>
        <h2 className="font-display text-lg font-medium text-ink">Relevé CSV</h2>
        <p className="mt-1 text-xs text-ink-mute">
          Encodage base64 automatique. Format attendu : date · libellé · montant.
        </p>
      </header>
      <form onSubmit={handle} className="grid gap-4 p-5 md:grid-cols-2">
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="s-file">Fichier CSV</Label>
          <Input id="s-file" type="file" accept=".csv,text/csv" onChange={handleFile} required />
          {fileName && (
            <p className="font-mono text-[11px] text-ink-mute">{fileName}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-start">Période début</Label>
          <Input
            id="s-start"
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-end">Période fin</Label>
          <Input
            id="s-end"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-open">Solde d&apos;ouverture</Label>
          <Input
            id="s-open"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            placeholder="15000000.00"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-close">Solde de clôture</Label>
          <Input
            id="s-close"
            value={closingBalance}
            onChange={(e) => setClosingBalance(e.target.value)}
            placeholder="12500000.00"
            required
          />
        </div>
        {mut.isError && (
          <div className="md:col-span-2">
            <FormError error={mut.error} />
          </div>
        )}
        <div className="md:col-span-2">
          <Button
            type="submit"
            disabled={mut.isPending || fileContent.length === 0}
            className="press"
          >
            {mut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 h-4 w-4" />
            )}
            Importer le relevé
          </Button>
        </div>
      </form>
    </section>
  );
}

// Suppress unused export warning for type kept for downstream consumers
export type { StatementLine };
