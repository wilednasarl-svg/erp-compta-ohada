'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2, Rows3, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { api, ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountingPeriodView } from '@/types/journals';

/* ─── Types (miroir des contrats backend reports) ─────────────── */

interface TrialBalanceRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly accountClass: number;
  readonly openingDebit: string;
  readonly openingCredit: string;
  readonly periodDebit: string;
  readonly periodCredit: string;
  readonly endingDebit: string;
  readonly endingCredit: string;
}

interface TrialBalanceReport {
  readonly fromDate: string;
  readonly toDate: string;
  readonly rows: ReadonlyArray<TrialBalanceRow>;
  readonly totals: {
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
  };
}

type LedgerSide = 'D' | 'C';

interface GeneralLedgerEntry {
  readonly lineId: string;
  readonly entryId: string;
  readonly entryDate: string;
  readonly journalCode: string;
  readonly entryNumber: number;
  readonly description: string | null;
  readonly debit: string;
  readonly credit: string;
  readonly letteringCode: string | null;
  readonly runningBalanceAbs: string;
  readonly runningBalanceSide: LedgerSide;
}

interface GeneralLedgerReport {
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountLabel: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly opening: {
    readonly openingBalance: string;
    readonly openingBalanceSide: LedgerSide;
  };
  readonly lines: ReadonlyArray<GeneralLedgerEntry>;
  readonly totals: {
    readonly periodDebit: string;
    readonly periodCredit: string;
    readonly endingDebit: string;
    readonly endingCredit: string;
  };
}

/* ─── Helpers ─────────────────────────────────────────────────── */

const FMT2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Montant ; chaîne vide pour zéro (réduit le bruit visuel dans les colonnes). */
function money(s: string): string {
  const n = Number(s);
  return n === 0 ? '' : FMT2.format(n);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Solde net d'un compte de balance : >0 = débiteur (D), <0 = créditeur (C). */
function rowSolde(row: TrialBalanceRow): { abs: number; side: LedgerSide } {
  const net = Number(row.endingDebit) - Number(row.endingCredit);
  return { abs: Math.abs(net), side: net >= 0 ? 'D' : 'C' };
}

/* Teinte déterministe d'un code de lettrage (cohérent avec /lettering). */
const CODE_TINTS: ReadonlyArray<string> = [
  'bg-accent-soft text-accent-ink',
  'bg-info-soft text-info-ink',
  'bg-warn-soft text-warn-ink',
  'bg-critical-soft text-critical-ink',
];
function codeTint(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return CODE_TINTS[h % CODE_TINTS.length]!;
}

/* ─── Page ────────────────────────────────────────────────────── */

export default function GrandLivrePage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [exerciseId, setExerciseId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);

  /* Exercices (périodes racines) */
  const periodsQuery = useQuery<ReadonlyArray<AccountingPeriodView>, ApiError>({
    queryKey: ['accounting-periods', orgId],
    queryFn: async () => {
      const resp = await api.get<{ periods: ReadonlyArray<AccountingPeriodView> }>(
        `/organizations/${orgId}/accounting-periods`,
      );
      return resp.periods;
    },
    enabled: orgId !== '',
  });

  const rootPeriods = useMemo(
    () =>
      (periodsQuery.data ?? [])
        .filter((p) => p.parentId === null)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [periodsQuery.data],
  );

  useEffect(() => {
    if (!exerciseId && rootPeriods.length > 0) setExerciseId(rootPeriods[0]!.id);
  }, [rootPeriods, exerciseId]);

  const exercise = rootPeriods.find((p) => p.id === exerciseId);
  const fromDate = exercise?.startDate;
  const toDate = exercise?.endDate;
  const datesReady = !!fromDate && !!toDate;

  /* Balance générale (panneau gauche) */
  const tbQuery = useQuery<TrialBalanceReport, ApiError>({
    queryKey: ['trial-balance', orgId, fromDate, toDate, hideEmpty],
    queryFn: async () => {
      const resp = await api.get<{ report: TrialBalanceReport }>(
        `/organizations/${orgId}/reports/trial-balance?fromDate=${fromDate}&toDate=${toDate}&hideEmpty=${hideEmpty}`,
      );
      return resp.report;
    },
    enabled: orgId !== '' && datesReady,
  });

  /* Grand livre du compte sélectionné (panneau droit) */
  const glQuery = useQuery<GeneralLedgerReport, ApiError>({
    queryKey: ['general-ledger', orgId, selectedAccountId, fromDate, toDate],
    queryFn: async () => {
      const resp = await api.get<{ report: GeneralLedgerReport }>(
        `/organizations/${orgId}/reports/general-ledger/${selectedAccountId}?fromDate=${fromDate}&toDate=${toDate}`,
      );
      return resp.report;
    },
    enabled: orgId !== '' && datesReady && selectedAccountId !== null,
  });

  const accounts = useMemo(() => tbQuery.data?.rows ?? [], [tbQuery.data]);
  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '') return accounts;
    return accounts.filter(
      (a) => a.accountCode.toLowerCase().includes(q) || a.accountLabel.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  async function exportXlsx(): Promise<void> {
    if (selectedAccountId === null || !datesReady) return;
    await api.download(
      `/organizations/${orgId}/reports/general-ledger/${selectedAccountId}.xlsx?fromDate=${fromDate}&toDate=${toDate}`,
      'grand-livre.xlsx',
    );
  }

  return (
    <AppShell>
      <div className="w-full animate-page-in space-y-6">
        {/* ─── En-tête ──────────────────────────────────────── */}
        <header className="flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow mb-2">États</p>
            <h1 className="font-display text-3xl font-medium tracking-tight text-ink">
              <span className="mark">Grand-livre</span>
            </h1>
            <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-ink-soft">
              La balance par compte à gauche, le détail des écritures à droite. Cliquez un compte pour
              dérouler son grand-livre.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="gl-exercise" className="text-xs font-medium text-ink-mute">
              Exercice
            </label>
            <select
              id="gl-exercise"
              value={exerciseId}
              onChange={(e) => {
                setExerciseId(e.target.value);
                setSelectedAccountId(null);
              }}
              className="rounded-sm border border-line-strong bg-paper px-3 py-1.5 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
            >
              {rootPeriods.length === 0 && <option value="">—</option>}
              {rootPeriods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        {!datesReady ? (
          <EmptyWorkspace
            title="Aucun exercice ouvert"
            description="Ouvrez un exercice comptable pour consulter le grand-livre."
          />
        ) : (
          <div className="grid overflow-hidden rounded-md border border-line bg-paper lg:grid-cols-[360px_1fr]">
            {/* ── Panneau gauche : comptes ── */}
            <aside className="flex min-h-[420px] flex-col border-b border-line lg:max-h-[72vh] lg:border-b-0 lg:border-r">
              <div className="space-y-3 border-b border-line bg-sunk/40 p-3">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute"
                    strokeWidth={1.5}
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher un compte…"
                    aria-label="Rechercher un compte"
                    className="h-9 w-full rounded-sm border border-line-strong bg-paper pl-8 pr-3 text-sm text-ink transition-colors focus:border-accent focus:outline-none"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-mute">
                  <input
                    type="checkbox"
                    checked={hideEmpty}
                    onChange={(e) => setHideEmpty(e.target.checked)}
                    className="h-3.5 w-3.5 rounded-xs border-line-strong text-accent focus:ring-1 focus:ring-accent"
                  />
                  Masquer les comptes sans mouvement
                </label>
              </div>

              <div className="min-h-0 flex-1 lg:overflow-y-auto">
                {tbQuery.isLoading ? (
                  <ListSkeleton />
                ) : tbQuery.error ? (
                  <p className="p-4 text-sm text-ink-mute">Impossible de charger la balance.</p>
                ) : filteredAccounts.length === 0 ? (
                  <p className="p-4 text-sm text-ink-mute">
                    {search.trim() !== '' ? 'Aucun compte ne correspond.' : 'Aucun compte mouvementé.'}
                  </p>
                ) : (
                  <ul>
                    {filteredAccounts.map((acc) => {
                      const solde = rowSolde(acc);
                      const active = acc.accountId === selectedAccountId;
                      return (
                        <li key={acc.accountId}>
                          <button
                            type="button"
                            onClick={() => setSelectedAccountId(acc.accountId)}
                            aria-pressed={active}
                            className={cn(
                              'flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left transition-colors duration-fast',
                              active ? 'bg-accent-soft' : 'hover:bg-sunk/60',
                            )}
                          >
                            <span
                              className={cn(
                                'shrink-0 rounded-xs px-1.5 py-0.5 font-mono text-[11px] font-medium',
                                active ? 'bg-paper text-accent-ink' : 'bg-sunk text-ink-soft',
                              )}
                            >
                              {acc.accountCode}
                            </span>
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate text-sm',
                                active ? 'font-medium text-accent-ink' : 'text-ink',
                              )}
                              title={acc.accountLabel}
                            >
                              {acc.accountLabel}
                            </span>
                            <span className="num shrink-0 text-right text-xs tabular-nums text-ink-soft">
                              {solde.abs === 0 ? '—' : `${FMT2.format(solde.abs)} ${solde.side}`}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </aside>

            {/* ── Panneau droit : grand-livre du compte ── */}
            <section className="flex min-h-[420px] flex-col lg:max-h-[72vh]">
              {selectedAccountId === null ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk text-ink-mute">
                    <Rows3 className="h-5 w-5" strokeWidth={1.5} />
                  </span>
                  <p className="text-sm font-medium text-ink">Sélectionnez un compte</p>
                  <p className="max-w-[40ch] text-xs text-ink-mute">
                    Choisissez un compte dans la balance à gauche pour afficher son grand-livre détaillé.
                  </p>
                </div>
              ) : glQuery.isLoading ? (
                <LedgerSkeleton />
              ) : glQuery.error || !glQuery.data ? (
                <p className="p-6 text-sm text-ink-mute">Impossible de charger le grand-livre du compte.</p>
              ) : (
                <LedgerDetail report={glQuery.data} onExport={() => void exportXlsx()} />
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ─── Détail grand-livre ─────────────────────────────────────── */

function LedgerDetail({
  report,
  onExport,
}: {
  report: GeneralLedgerReport;
  onExport: () => void;
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-line bg-sunk/40 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-xs bg-paper px-1.5 py-0.5 font-mono text-xs font-medium text-ink-soft">
              {report.accountCode}
            </span>
            <h2 className="truncate font-display text-base text-ink" title={report.accountLabel}>
              {report.accountLabel}
            </h2>
          </div>
          <p className="mt-1 text-xs text-ink-mute">
            Solde d&apos;ouverture :{' '}
            <span className="num tabular-nums text-ink-soft">
              {Number(report.opening.openingBalance) === 0
                ? '0,00'
                : `${FMT2.format(Number(report.opening.openingBalance))} ${report.opening.openingBalanceSide}`}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onExport}
          className="press inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line-strong bg-paper px-2.5 py-1.5 text-xs font-medium text-ink transition-colors duration-fast hover:bg-sunk"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
          Excel
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-auto lg:overflow-auto">
        {report.lines.length === 0 ? (
          <p className="p-6 text-sm text-ink-mute">Aucune écriture sur la période.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-sunk">
              <tr className="border-b border-line text-left">
                <Th>Date</Th>
                <Th>Jrnl</Th>
                <Th className="min-w-[180px]">Libellé</Th>
                <Th className="text-center">N°</Th>
                <Th className="text-right">Débit</Th>
                <Th className="text-right">Crédit</Th>
                <Th className="text-center">Let.</Th>
                <Th className="text-right">Solde</Th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((l) => (
                <tr
                  key={l.lineId}
                  className="border-b border-line transition-colors duration-fast last:border-0 hover:bg-sunk/40"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-ink-soft">{fmtDate(l.entryDate)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-xs bg-sunk px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-soft">
                      {l.journalCode}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink">{l.description ?? <span className="text-ink-mute">—</span>}</td>
                  <td className="px-3 py-2 text-center font-mono text-xs text-ink-mute">{l.entryNumber}</td>
                  <td className="num px-3 py-2 text-right text-xs tabular-nums text-ink">{money(l.debit)}</td>
                  <td className="num px-3 py-2 text-right text-xs tabular-nums text-ink">{money(l.credit)}</td>
                  <td className="px-3 py-2 text-center">
                    {l.letteringCode ? (
                      <span className={cn('rounded-xs px-1.5 py-0.5 font-mono text-[10px] font-medium', codeTint(l.letteringCode))}>
                        {l.letteringCode}
                      </span>
                    ) : (
                      <span className="text-ink-mute">·</span>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-right text-xs tabular-nums text-ink-soft">
                    {FMT2.format(Number(l.runningBalanceAbs))} {l.runningBalanceSide}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-paper">
              <tr className="border-t border-line-strong font-medium">
                <td className="px-3 py-2.5 text-xs uppercase tracking-wider text-ink-mute" colSpan={4}>
                  Totaux période
                </td>
                <td className="num px-3 py-2.5 text-right text-xs tabular-nums text-ink">{money(report.totals.periodDebit)}</td>
                <td className="num px-3 py-2.5 text-right text-xs tabular-nums text-ink">{money(report.totals.periodCredit)}</td>
                <td />
                <td className="num px-3 py-2.5 text-right text-xs tabular-nums text-ink">
                  {(() => {
                    const net = Number(report.totals.endingDebit) - Number(report.totals.endingCredit);
                    return `${FMT2.format(Math.abs(net))} ${net >= 0 ? 'D' : 'C'}`;
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2', className)}><span className="eyebrow">{children}</span></th>;
}

/* ─── Skeletons & vides ──────────────────────────────────────── */

function ListSkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-3 py-2.5">
          <div className="h-4 w-12 animate-pulse rounded-xs bg-sunk" />
          <div className="h-3.5 flex-1 animate-pulse rounded-xs bg-sunk" />
          <div className="h-3.5 w-14 animate-pulse rounded-xs bg-sunk" />
        </div>
      ))}
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="flex-1 space-y-px p-4" aria-hidden>
      <div className="mb-4 h-6 w-56 animate-pulse rounded-xs bg-sunk" />
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-2">
          <div className="h-3.5 w-16 animate-pulse rounded-xs bg-sunk" />
          <div className="h-3.5 flex-1 animate-pulse rounded-xs bg-sunk" />
          <div className="h-3.5 w-20 animate-pulse rounded-xs bg-sunk" />
          <div className="h-3.5 w-20 animate-pulse rounded-xs bg-sunk" />
        </div>
      ))}
    </div>
  );
}

function EmptyWorkspace({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border border-line bg-paper px-6 py-16 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-sunk text-ink-mute">
        <FileText className="h-5 w-5" strokeWidth={1.5} />
      </span>
      <p className="mt-4 text-sm font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-[44ch] text-xs text-ink-mute">{description}</p>
    </div>
  );
}
