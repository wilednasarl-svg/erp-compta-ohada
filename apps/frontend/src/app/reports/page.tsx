'use client';

import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  BookText,
  Calculator,
  FileSpreadsheet,
  Loader2,
  TrendingUp,
  Wallet,
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
import { ApiError, api } from '@/lib/api-client';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountView } from '@/types/accounting-plan';
import type {
  CashTrendReport,
  ComparativeBalanceReport,
  FinancialRatiosReport,
  GeneralLedgerReport,
  SigReport,
  TrialBalanceReport,
} from '@/types/reports';

interface AccountsResponse {
  readonly accounts: ReadonlyArray<AccountView>;
}
interface TrialBalanceEnvelope {
  readonly report: TrialBalanceReport;
}
interface GeneralLedgerEnvelope {
  readonly report: GeneralLedgerReport;
}
interface ComparativeBalanceEnvelope {
  readonly report: ComparativeBalanceReport;
}
interface SigEnvelope {
  readonly report: SigReport;
}
interface FinancialRatiosEnvelope {
  readonly report: FinancialRatiosReport;
}
interface CashTrendEnvelope {
  readonly report: CashTrendReport;
}

type ReportMode =
  | 'trial-balance'
  | 'comparative-balance'
  | 'sig'
  | 'ratios'
  | 'cash-trend'
  | 'general-ledger';

const previousYearStartIso = (): string => `${new Date().getFullYear() - 1}-01-01`;
const previousYearEndIso = (): string => `${new Date().getFullYear() - 1}-12-31`;

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const yearStartIso = (): string => `${new Date().getFullYear()}-01-01`;

/**
 * `/reports` — états financiers Module 9 wave 1.
 *
 *   - Balance générale (par compte, sur une période) avec filtres
 *     classe + tranche de codes + hideEmpty.
 *   - Grand Livre (par compte, lignes chronologiques + cumul).
 *
 * Pas de gating client par rôle — un user sans `journals.reports`
 * recevra FORBIDDEN_PERMISSION à la soumission, affiché inline.
 */
export default function ReportsPage() {
  const currentOrg = useCurrentOrg();
  const orgId = currentOrg?.id ?? '';

  const [mode, setMode] = useState<ReportMode>('trial-balance');

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">États financiers</h1>
          <Badge variant="outline">Module 9 — wave 1</Badge>
        </header>

        <div className="inline-flex rounded-md border bg-white p-1">
          <button
            type="button"
            onClick={() => setMode('trial-balance')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'trial-balance'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            Balance générale
          </button>
          <button
            type="button"
            onClick={() => setMode('comparative-balance')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'comparative-balance'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Balance comparative N/N-1
          </button>
          <button
            type="button"
            onClick={() => setMode('sig')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'sig'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <TrendingUp className="h-4 w-4" />
            SIG (SYSCOHADA)
          </button>
          <button
            type="button"
            onClick={() => setMode('ratios')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'ratios'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Calculator className="h-4 w-4" />
            Ratios financiers
          </button>
          <button
            type="button"
            onClick={() => setMode('cash-trend')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'cash-trend'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Wallet className="h-4 w-4" />
            Trésorerie glissante
          </button>
          <button
            type="button"
            onClick={() => setMode('general-ledger')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'general-ledger'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <BookText className="h-4 w-4" />
            Grand livre
          </button>
        </div>

        {mode === 'trial-balance' ? (
          <TrialBalancePanel orgId={orgId} />
        ) : mode === 'comparative-balance' ? (
          <ComparativeBalancePanel orgId={orgId} />
        ) : mode === 'sig' ? (
          <SigPanel orgId={orgId} />
        ) : mode === 'ratios' ? (
          <FinancialRatiosPanel orgId={orgId} />
        ) : mode === 'cash-trend' ? (
          <CashTrendPanel orgId={orgId} />
        ) : (
          <GeneralLedgerPanel orgId={orgId} />
        )}
      </div>
    </AppShell>
  );
}

// ─── Balance générale ───────────────────────────────────────────────────

function TrialBalancePanel({ orgId }: { readonly orgId: string }) {
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [accountClass, setAccountClass] = useState<string>('');
  const [codeFrom, setCodeFrom] = useState<string>('');
  const [codeTo, setCodeTo] = useState<string>('');
  const [hideEmpty, setHideEmpty] = useState<boolean>(true);
  const [submitted, setSubmitted] = useState<{
    fromDate: string;
    toDate: string;
    accountClass?: string;
    codeFrom?: string;
    codeTo?: string;
    hideEmpty?: boolean;
  } | null>(null);

  const query = useQuery<TrialBalanceReport, ApiError>({
    queryKey: ['reports', 'trial-balance', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) {
        throw new Error('not submitted');
      }
      const params = new URLSearchParams({
        fromDate: submitted.fromDate,
        toDate: submitted.toDate,
      });
      if (submitted.accountClass !== undefined && submitted.accountClass !== '') {
        params.set('accountClass', submitted.accountClass);
      }
      if (submitted.codeFrom !== undefined && submitted.codeFrom !== '') {
        params.set('accountCodeFrom', submitted.codeFrom);
      }
      if (submitted.codeTo !== undefined && submitted.codeTo !== '') {
        params.set('accountCodeTo', submitted.codeTo);
      }
      if (submitted.hideEmpty === true) {
        params.set('hideEmpty', 'true');
      }
      const data = await api.get<TrialBalanceEnvelope>(
        `/organizations/${orgId}/reports/trial-balance?${params.toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balance générale</CardTitle>
        <CardDescription>
          Solde de chaque compte sur la période : ouverture + mouvements + clôture. Seules les
          écritures validées sont projetées.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({
              fromDate,
              toDate,
              accountClass,
              codeFrom,
              codeTo,
              hideEmpty,
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="tb-from">Du</Label>
            <Input
              id="tb-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tb-to">Au</Label>
            <Input
              id="tb-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tb-class">Classe</Label>
            <select
              id="tb-class"
              value={accountClass}
              onChange={(e) => setAccountClass(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">Toutes</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => (
                <option key={c} value={c}>
                  Classe {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tb-code-from">Code de</Label>
            <Input
              id="tb-code-from"
              placeholder="ex. 411"
              value={codeFrom}
              onChange={(e) => setCodeFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tb-code-to">Code à</Label>
            <Input
              id="tb-code-to"
              placeholder="ex. 419"
              value={codeTo}
              onChange={(e) => setCodeTo(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
              />
              Masquer comptes inactifs
            </label>
          </div>
          <div className="sm:col-span-2 lg:col-span-6">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer
            </Button>
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? (
          <TrialBalanceTable report={query.data} />
        ) : submitted === null ? (
          <p className="text-sm text-slate-500">
            Choisissez la période puis cliquez sur « Générer ».
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TrialBalanceTable({ report }: { readonly report: TrialBalanceReport }) {
  if (report.rows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Aucun mouvement sur la période avec ces filtres.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <th className="px-2 py-2">Compte</th>
            <th className="px-2 py-2">Libellé</th>
            <th className="px-2 py-2 text-right">Ouverture débit</th>
            <th className="px-2 py-2 text-right">Ouverture crédit</th>
            <th className="px-2 py-2 text-right">Mouvement débit</th>
            <th className="px-2 py-2 text-right">Mouvement crédit</th>
            <th className="px-2 py-2 text-right">Solde débit</th>
            <th className="px-2 py-2 text-right">Solde crédit</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.accountId} className="border-b hover:bg-slate-50">
              <td className="px-2 py-1 font-mono text-xs">{row.accountCode}</td>
              <td className="px-2 py-1">{row.accountLabel}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.openingDebit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.openingCredit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.periodDebit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.periodCredit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.endingDebit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.endingCredit)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 bg-slate-100 font-medium">
            <td className="px-2 py-2" colSpan={2}>
              Totaux
            </td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.openingDebit)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.openingCredit)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.periodDebit)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.periodCredit)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.endingDebit)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.endingCredit)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Grand livre ────────────────────────────────────────────────────────

function GeneralLedgerPanel({ orgId }: { readonly orgId: string }) {
  const [accountId, setAccountId] = useState<string>('');
  const [codeQuery, setCodeQuery] = useState<string>('');
  const [accountClass, setAccountClass] = useState<string>('');
  const [codeFrom, setCodeFrom] = useState<string>('');
  const [codeTo, setCodeTo] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [submitted, setSubmitted] = useState<{
    accountId: string;
    fromDate: string;
    toDate: string;
  } | null>(null);

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

  const ledgerQuery = useQuery<GeneralLedgerReport, ApiError>({
    queryKey: ['reports', 'general-ledger', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) {
        throw new Error('not submitted');
      }
      const params = new URLSearchParams({
        fromDate: submitted.fromDate,
        toDate: submitted.toDate,
      });
      const data = await api.get<GeneralLedgerEnvelope>(
        `/organizations/${orgId}/reports/general-ledger/${submitted.accountId}?${params.toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  // Filtre côté client : classe + plage code de/à + recherche libre.
  // Le backend `/general-ledger/:accountId` n'accepte qu'un compte unique,
  // donc on filtre la liste de sélection ici plutôt que d'envoyer une
  // plage au serveur (qui exigerait un autre endpoint).
  const filteredAccounts = useMemo(() => {
    const all = (accountsQuery.data ?? []).slice().sort((a, b) => a.code.localeCompare(b.code));
    return all.filter((a) => {
      if (accountClass !== '' && !a.code.startsWith(accountClass)) {
        return false;
      }
      if (codeFrom !== '' && a.code < codeFrom) {
        return false;
      }
      if (codeTo !== '' && a.code > codeTo) {
        return false;
      }
      if (codeQuery !== '') {
        const q = codeQuery.toLowerCase();
        if (!a.code.toLowerCase().includes(q) && !a.label.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [accountsQuery.data, accountClass, codeFrom, codeTo, codeQuery]);

  // Si la saisie libre matche exactement un seul compte (par code), le
  // pré-sélectionner pour éviter un aller-retour vers le dropdown.
  const matchedByCode = useMemo(() => {
    if (codeQuery === '') return null;
    const exact = filteredAccounts.find((a) => a.code === codeQuery.trim());
    return exact ?? null;
  }, [codeQuery, filteredAccounts]);

  const effectiveAccountId = accountId !== '' ? accountId : (matchedByCode?.id ?? '');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grand livre</CardTitle>
        <CardDescription>
          Lignes chronologiques d&apos;un compte avec solde cumulé. Seules les écritures validées
          apparaissent ; le solde initial reflète tout ce qui précède la date de début.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (effectiveAccountId === '') {
              return;
            }
            setSubmitted({ accountId: effectiveAccountId, fromDate, toDate });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="gl-class">Classe</Label>
            <select
              id="gl-class"
              value={accountClass}
              onChange={(e) => {
                setAccountClass(e.target.value);
                setAccountId('');
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">Toutes</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => (
                <option key={c} value={c}>
                  Classe {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-code-from">Code de</Label>
            <Input
              id="gl-code-from"
              placeholder="ex. 411"
              value={codeFrom}
              onChange={(e) => {
                setCodeFrom(e.target.value);
                setAccountId('');
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-code-to">Code à</Label>
            <Input
              id="gl-code-to"
              placeholder="ex. 419"
              value={codeTo}
              onChange={(e) => {
                setCodeTo(e.target.value);
                setAccountId('');
              }}
            />
          </div>
          <div className="space-y-1 lg:col-span-3">
            <Label htmlFor="gl-search">Recherche (code ou libellé)</Label>
            <Input
              id="gl-search"
              placeholder="Saisir un code (ex. 411000) ou libellé"
              value={codeQuery}
              onChange={(e) => {
                setCodeQuery(e.target.value);
                setAccountId('');
              }}
              list="gl-account-codes"
            />
            <datalist id="gl-account-codes">
              {filteredAccounts.slice(0, 50).map((a) => (
                <option key={a.id} value={a.code}>
                  {a.label}
                </option>
              ))}
            </datalist>
          </div>
          <div className="space-y-1 lg:col-span-4">
            <Label htmlFor="gl-account">Compte sélectionné</Label>
            <select
              id="gl-account"
              value={effectiveAccountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                setCodeQuery('');
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              required
            >
              <option value="">
                — {filteredAccounts.length} compte(s) disponible(s) —
              </option>
              {filteredAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-from">Du</Label>
            <Input
              id="gl-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gl-to">Au</Label>
            <Input
              id="gl-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-6">
            <Button type="submit" disabled={ledgerQuery.isFetching || effectiveAccountId === ''}>
              {ledgerQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Afficher
            </Button>
          </div>
        </form>

        {ledgerQuery.isError ? <FormError error={ledgerQuery.error} /> : null}

        {ledgerQuery.data !== undefined ? (
          <GeneralLedgerTable report={ledgerQuery.data} />
        ) : submitted === null ? (
          <p className="text-sm text-slate-500">
            Filtrez puis choisissez un compte (ou tapez son code) et cliquez sur « Afficher ».
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GeneralLedgerTable({ report }: { readonly report: GeneralLedgerReport }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-slate-50 px-3 py-2 text-sm">
        <span className="font-mono">{report.accountCode}</span>
        <span className="font-medium">{report.accountLabel}</span>
        <span className="ml-auto text-xs text-slate-500">
          Solde d&apos;ouverture : <span className="font-mono">{fmt(report.opening.openingDebit)}</span> D /{' '}
          <span className="font-mono">{fmt(report.opening.openingCredit)}</span> C
        </span>
      </div>

      {report.lines.length === 0 ? (
        <p className="text-sm text-slate-500">Aucun mouvement sur la période pour ce compte.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Journal</th>
                <th className="px-2 py-2">N°</th>
                <th className="px-2 py-2">Libellé</th>
                <th className="px-2 py-2">Lettrage</th>
                <th className="px-2 py-2 text-right">Débit</th>
                <th className="px-2 py-2 text-right">Crédit</th>
                <th className="px-2 py-2 text-right">Solde</th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((line) => (
                <tr key={line.lineId} className="border-b hover:bg-slate-50">
                  <td className="px-2 py-1 whitespace-nowrap">{line.entryDate}</td>
                  <td className="px-2 py-1 font-mono text-xs">{line.journalCode}</td>
                  <td className="px-2 py-1 text-right font-mono text-xs">{line.entryNumber}</td>
                  <td className="px-2 py-1">{line.description ?? '—'}</td>
                  <td className="px-2 py-1 font-mono text-xs">{line.letteringCode ?? '—'}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(line.debit)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(line.credit)}</td>
                  <td className="px-2 py-1 text-right font-mono font-medium">
                    {fmt(line.runningBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-slate-100 font-medium">
                <td className="px-2 py-2" colSpan={5}>
                  Totaux période
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.periodDebit)}</td>
                <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.periodCredit)}</td>
                <td className="px-2 py-2 text-right font-mono">
                  {fmt(report.totals.endingDebit)} D / {fmt(report.totals.endingCredit)} C
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Balance comparative N / N-1 ───────────────────────────────────────

function ComparativeBalancePanel({ orgId }: { readonly orgId: string }) {
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [previousFromDate, setPreviousFromDate] = useState<string>(previousYearStartIso());
  const [previousToDate, setPreviousToDate] = useState<string>(previousYearEndIso());
  const [accountClass, setAccountClass] = useState<string>('');
  const [codeFrom, setCodeFrom] = useState<string>('');
  const [codeTo, setCodeTo] = useState<string>('');
  const [hideEmpty, setHideEmpty] = useState<boolean>(true);
  const [submitted, setSubmitted] = useState<{
    fromDate: string;
    toDate: string;
    previousFromDate: string;
    previousToDate: string;
    accountClass?: string;
    codeFrom?: string;
    codeTo?: string;
    hideEmpty?: boolean;
  } | null>(null);

  const buildSearchParams = (s: NonNullable<typeof submitted>): URLSearchParams => {
    const params = new URLSearchParams({
      fromDate: s.fromDate,
      toDate: s.toDate,
      previousFromDate: s.previousFromDate,
      previousToDate: s.previousToDate,
    });
    if (s.accountClass !== undefined && s.accountClass !== '') {
      params.set('accountClass', s.accountClass);
    }
    if (s.codeFrom !== undefined && s.codeFrom !== '') {
      params.set('accountCodeFrom', s.codeFrom);
    }
    if (s.codeTo !== undefined && s.codeTo !== '') {
      params.set('accountCodeTo', s.codeTo);
    }
    if (s.hideEmpty === true) {
      params.set('hideEmpty', 'true');
    }
    return params;
  };

  const query = useQuery<ComparativeBalanceReport, ApiError>({
    queryKey: ['reports', 'comparative-balance', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) {
        throw new Error('not submitted');
      }
      const data = await api.get<ComparativeBalanceEnvelope>(
        `/organizations/${orgId}/reports/comparative-balance?${buildSearchParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    const url = `/api/organizations/${orgId}/reports/comparative-balance.xlsx?${buildSearchParams(submitted).toString()}`;
    window.open(url, '_blank');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balance comparative N / N-1</CardTitle>
        <CardDescription>
          Mouvements de l&apos;exercice N-1 et N côte à côte avec le solde cumulé à la fin de
          la période N. Reproduit le layout des balances Sage SYSCOHADA pluri-exercices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({
              fromDate,
              toDate,
              previousFromDate,
              previousToDate,
              accountClass,
              codeFrom,
              codeTo,
              hideEmpty,
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="cb-prev-from">N-1 — du</Label>
            <Input
              id="cb-prev-from"
              type="date"
              value={previousFromDate}
              onChange={(e) => setPreviousFromDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cb-prev-to">N-1 — au</Label>
            <Input
              id="cb-prev-to"
              type="date"
              value={previousToDate}
              onChange={(e) => setPreviousToDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cb-from">N — du</Label>
            <Input
              id="cb-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cb-to">N — au</Label>
            <Input
              id="cb-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cb-class">Classe</Label>
            <select
              id="cb-class"
              value={accountClass}
              onChange={(e) => setAccountClass(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="">Toutes</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => (
                <option key={c} value={c}>
                  Classe {c}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cb-code-from">Code de</Label>
            <Input
              id="cb-code-from"
              placeholder="ex. 411"
              value={codeFrom}
              onChange={(e) => setCodeFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cb-code-to">Code à</Label>
            <Input
              id="cb-code-to"
              placeholder="ex. 419"
              value={codeTo}
              onChange={(e) => setCodeTo(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideEmpty}
                onChange={(e) => setHideEmpty(e.target.checked)}
              />
              Masquer comptes inactifs
            </label>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer
            </Button>
            {query.data !== undefined ? (
              <Button type="button" variant="outline" onClick={downloadXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export Excel
              </Button>
            ) : null}
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? (
          <ComparativeBalanceTable report={query.data} />
        ) : submitted === null ? (
          <p className="text-sm text-slate-500">
            Choisissez les deux périodes puis cliquez sur « Générer ».
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ComparativeBalanceTable({
  report,
}: {
  readonly report: ComparativeBalanceReport;
}) {
  if (report.rows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Aucun mouvement sur les périodes avec ces filtres.
      </p>
    );
  }
  const yearN = report.toDate.slice(0, 4);
  const yearNm1 = report.previousToDate.slice(0, 4);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <th className="px-2 py-2" rowSpan={2}>
              Compte
            </th>
            <th className="px-2 py-2" rowSpan={2}>
              Intitulé
            </th>
            <th className="px-2 py-2 text-center" colSpan={2}>
              Mouvement {yearNm1}
            </th>
            <th className="px-2 py-2 text-center" colSpan={2}>
              Mouvement {yearN}
            </th>
            <th className="px-2 py-2 text-center" colSpan={2}>
              Solde
            </th>
            <th className="px-2 py-2 text-right" rowSpan={2}>
              Variation
            </th>
            <th className="px-2 py-2 text-right" rowSpan={2}>
              % Évol.
            </th>
          </tr>
          <tr className="border-b bg-slate-50 text-right text-xs text-slate-600">
            <th className="px-2 py-1">Débit</th>
            <th className="px-2 py-1">Crédit</th>
            <th className="px-2 py-1">Débit</th>
            <th className="px-2 py-1">Crédit</th>
            <th className="px-2 py-1">Débit</th>
            <th className="px-2 py-1">Crédit</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.accountId} className="border-b hover:bg-slate-50">
              <td className="px-2 py-1 font-mono text-xs">{row.accountCode}</td>
              <td className="px-2 py-1">{row.accountLabel}</td>
              <td className="px-2 py-1 text-right font-mono">
                {fmt(row.previousPeriodDebit)}
              </td>
              <td className="px-2 py-1 text-right font-mono">
                {fmt(row.previousPeriodCredit)}
              </td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.periodDebit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.periodCredit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.endingDebit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.endingCredit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.netVariation)}</td>
              <td className="px-2 py-1 text-right font-mono text-xs text-slate-500">
                {row.netVariationPercent !== null ? `${row.netVariationPercent}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 bg-slate-100 font-medium">
            <td className="px-2 py-2" colSpan={2}>
              Totaux
            </td>
            <td className="px-2 py-2 text-right font-mono">
              {fmt(report.totals.previousPeriodDebit)}
            </td>
            <td className="px-2 py-2 text-right font-mono">
              {fmt(report.totals.previousPeriodCredit)}
            </td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.periodDebit)}</td>
            <td className="px-2 py-2 text-right font-mono">
              {fmt(report.totals.periodCredit)}
            </td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.endingDebit)}</td>
            <td className="px-2 py-2 text-right font-mono">
              {fmt(report.totals.endingCredit)}
            </td>
            <td className="px-2 py-2"></td>
            <td className="px-2 py-2"></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── SIG (Soldes Intermédiaires de Gestion) ────────────────────────────

function SigPanel({ orgId }: { readonly orgId: string }) {
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [compare, setCompare] = useState<boolean>(false);
  const [compareFromDate, setCompareFromDate] = useState<string>(previousYearStartIso());
  const [compareToDate, setCompareToDate] = useState<string>(previousYearEndIso());
  const [submitted, setSubmitted] = useState<{
    fromDate: string;
    toDate: string;
    compareFromDate?: string;
    compareToDate?: string;
  } | null>(null);

  const buildSearchParams = (s: NonNullable<typeof submitted>): URLSearchParams => {
    const params = new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate });
    if (s.compareFromDate !== undefined && s.compareToDate !== undefined) {
      params.set('compareFromDate', s.compareFromDate);
      params.set('compareToDate', s.compareToDate);
    }
    return params;
  };

  const query = useQuery<SigReport, ApiError>({
    queryKey: ['reports', 'sig', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) {
        throw new Error('not submitted');
      }
      const data = await api.get<SigEnvelope>(
        `/organizations/${orgId}/reports/sig?${buildSearchParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    const url = `/api/organizations/${orgId}/reports/sig.xlsx?${buildSearchParams(submitted).toString()}`;
    window.open(url, '_blank');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Soldes Intermédiaires de Gestion (SIG)</CardTitle>
        <CardDescription>
          Cascade officielle SYSCOHADA AUDCIF : Marge commerciale (XA) → Chiffre d&apos;affaires
          (XB) → Valeur ajoutée (XC) → Excédent brut d&apos;exploitation (XD) → Résultat
          d&apos;exploitation (XE) → Résultat financier (XF) → Résultat des activités
          ordinaires (XG) → Résultat HAO (XH) → Résultat net (XI). Postes RA→RS pour les
          charges, TA→TO pour les produits, mappés sur les comptes OHADA.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({
              fromDate,
              toDate,
              compareFromDate: compare ? compareFromDate : undefined,
              compareToDate: compare ? compareToDate : undefined,
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="sig-from">Du</Label>
            <Input
              id="sig-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sig-to">Au</Label>
            <Input
              id="sig-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
              />
              Comparer avec N-1
            </label>
          </div>
          {compare ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="sig-prev-from">N-1 — du</Label>
                <Input
                  id="sig-prev-from"
                  type="date"
                  value={compareFromDate}
                  onChange={(e) => setCompareFromDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sig-prev-to">N-1 — au</Label>
                <Input
                  id="sig-prev-to"
                  type="date"
                  value={compareToDate}
                  onChange={(e) => setCompareToDate(e.target.value)}
                  required
                />
              </div>
            </>
          ) : null}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer
            </Button>
            {query.data !== undefined ? (
              <Button type="button" variant="outline" onClick={downloadXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export Excel
              </Button>
            ) : null}
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? <SigTable report={query.data} /> : submitted === null ? (
          <p className="text-sm text-slate-500">Choisissez la période puis cliquez sur « Générer ».</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SigTable({ report }: { readonly report: SigReport }) {
  const hasComp = report.previous !== undefined;
  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-slate-50 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
          Cascade des soldes (XA → XI)
        </h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-600">
              <th className="px-2 py-1">Réf.</th>
              <th className="px-2 py-1">Libellé</th>
              <th className="px-2 py-1 text-right">Montant N</th>
              {hasComp ? (
                <>
                  <th className="px-2 py-1 text-right">Montant N-1</th>
                  <th className="px-2 py-1 text-right">Variation</th>
                  <th className="px-2 py-1 text-right">% Évol.</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {report.soldes.map((s) => (
              <tr key={s.code} className="border-b">
                <td className="px-2 py-1 font-mono text-xs font-semibold">{s.code}</td>
                <td className="px-2 py-1">
                  <div className="font-medium">{s.label}</div>
                  <div className="text-xs text-slate-500">{s.formula}</div>
                </td>
                <td className="px-2 py-1 text-right font-mono font-semibold">{fmt(s.amount)}</td>
                {hasComp ? (
                  <>
                    <td className="px-2 py-1 text-right font-mono">{fmt(s.previousAmount ?? '0')}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(s.variation ?? '0')}</td>
                    <td className="px-2 py-1 text-right font-mono text-xs text-slate-500">
                      {s.variationPercent !== undefined && s.variationPercent !== null
                        ? `${s.variationPercent}%`
                        : '—'}
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SigPosteTable title="Produits (TA → TO)" postes={report.produits} hasComp={hasComp} />
        <SigPosteTable title="Charges (RA → RS)" postes={report.charges} hasComp={hasComp} />
      </div>
    </div>
  );
}

function SigPosteTable({
  title,
  postes,
  hasComp,
}: {
  readonly title: string;
  readonly postes: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly amount: string;
    readonly previousAmount?: string;
  }>;
  readonly hasComp: boolean;
}) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-slate-700">{title}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1">Réf.</th>
            <th className="px-2 py-1">Libellé</th>
            <th className="px-2 py-1 text-right">N</th>
            {hasComp ? <th className="px-2 py-1 text-right">N-1</th> : null}
          </tr>
        </thead>
        <tbody>
          {postes.map((p) => (
            <tr key={p.code} className="border-b hover:bg-slate-50">
              <td className="px-2 py-1 font-mono text-xs">{p.code}</td>
              <td className="px-2 py-1 text-xs">{p.label}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(p.amount)}</td>
              {hasComp ? (
                <td className="px-2 py-1 text-right font-mono text-slate-500">
                  {fmt(p.previousAmount ?? '0')}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Trésorerie nette glissante ────────────────────────────────────────

function CashTrendPanel({ orgId }: { readonly orgId: string }) {
  const today = new Date();
  const defaultTo = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}`;
  const defaultFromYear = today.getFullYear() - 1;
  const defaultFrom = `${defaultFromYear}-${(today.getMonth() + 1).toString().padStart(2, '0')}`;
  const [fromMonth, setFromMonth] = useState<string>(defaultFrom);
  const [toMonth, setToMonth] = useState<string>(defaultTo);
  const [submitted, setSubmitted] = useState<{ fromMonth: string; toMonth: string } | null>(null);

  const buildParams = (s: NonNullable<typeof submitted>): URLSearchParams =>
    new URLSearchParams({ fromMonth: s.fromMonth, toMonth: s.toMonth });

  const query = useQuery<CashTrendReport, ApiError>({
    queryKey: ['reports', 'cash-trend', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<CashTrendEnvelope>(
        `/organizations/${orgId}/reports/cash-trend?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    window.open(
      `/api/organizations/${orgId}/reports/cash-trend.xlsx?${buildParams(submitted).toString()}`,
      '_blank',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trésorerie nette glissante</CardTitle>
        <CardDescription>
          Évolution mois par mois du solde net de la classe 5 (banques, caisses). Un solde
          créditeur sur un compte 5 (découvert) vient en déduction de la trésorerie nette.
          Fenêtre maximum 60 mois.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ fromMonth, toMonth });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="ct-from">Du (YYYY-MM)</Label>
            <Input
              id="ct-from"
              type="month"
              value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-to">Au (YYYY-MM)</Label>
            <Input
              id="ct-to"
              type="month"
              value={toMonth}
              onChange={(e) => setToMonth(e.target.value)}
              required
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Calculer
            </Button>
            {query.data !== undefined ? (
              <Button type="button" variant="outline" onClick={downloadXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export
              </Button>
            ) : null}
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? <CashTrendTable report={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function CashTrendTable({ report }: { readonly report: CashTrendReport }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Trésorerie actuelle" value={report.currentNetCash} />
        <SummaryCard label="Min sur la période" value={report.minNetCash} />
        <SummaryCard label="Max sur la période" value={report.maxNetCash} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <th className="px-2 py-2">Mois</th>
              <th className="px-2 py-2">Coupure</th>
              <th className="px-2 py-2 text-right">Débit cumulé</th>
              <th className="px-2 py-2 text-right">Crédit cumulé</th>
              <th className="px-2 py-2 text-right">Trésorerie nette</th>
              <th className="px-2 py-2 text-right">Variation MoM</th>
            </tr>
          </thead>
          <tbody>
            {report.points.map((p) => {
              const net = Number(p.netCash);
              const change = p.change !== null ? Number(p.change) : null;
              return (
                <tr key={p.yearMonth} className="border-b hover:bg-slate-50">
                  <td className="px-2 py-1 font-mono text-xs">{p.yearMonth}</td>
                  <td className="px-2 py-1 text-xs text-slate-500">{p.asAtDate}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(p.totalDebit)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(p.totalCredit)}</td>
                  <td
                    className={`px-2 py-1 text-right font-mono font-semibold ${
                      net < 0 ? 'text-red-600' : ''
                    }`}
                  >
                    {fmt(p.netCash)}
                  </td>
                  <td
                    className={`px-2 py-1 text-right font-mono ${
                      change !== null && change < 0
                        ? 'text-red-600'
                        : change !== null && change > 0
                          ? 'text-emerald-600'
                          : ''
                    }`}
                  >
                    {p.change !== null ? fmt(p.change) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { readonly label: string; readonly value: string }) {
  const num = Number(value);
  return (
    <div className="rounded-md border bg-slate-50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-1 font-mono text-lg font-semibold ${
          num < 0 ? 'text-red-600' : 'text-slate-900'
        }`}
      >
        {fmt(value)}
      </div>
    </div>
  );
}

// ─── Ratios financiers ─────────────────────────────────────────────────

function FinancialRatiosPanel({ orgId }: { readonly orgId: string }) {
  const [asAtDate, setAsAtDate] = useState<string>(todayIso());
  const [fiscalYearStartDate, setFiscalYearStartDate] = useState<string>(yearStartIso());
  const [submitted, setSubmitted] = useState<{
    asAtDate: string;
    fiscalYearStartDate: string;
  } | null>(null);

  const buildSearchParams = (s: NonNullable<typeof submitted>): URLSearchParams =>
    new URLSearchParams({
      asAtDate: s.asAtDate,
      fiscalYearStartDate: s.fiscalYearStartDate,
    });

  const query = useQuery<FinancialRatiosReport, ApiError>({
    queryKey: ['reports', 'ratios', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<FinancialRatiosEnvelope>(
        `/organizations/${orgId}/reports/financial-ratios?${buildSearchParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    window.open(
      `/api/organizations/${orgId}/reports/financial-ratios.xlsx?${buildSearchParams(submitted).toString()}`,
      '_blank',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ratios financiers</CardTitle>
        <CardDescription>
          5 familles d&apos;indicateurs : structure financière, liquidité, solvabilité, rentabilité,
          activité. Calculés à partir du Bilan SYSCOHADA + des SIG. Seuils d&apos;interprétation
          conformes aux normes BCEAO / FANAF.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ asAtDate, fiscalYearStartDate });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="fr-fy-start">Début exercice</Label>
            <Input
              id="fr-fy-start"
              type="date"
              value={fiscalYearStartDate}
              onChange={(e) => setFiscalYearStartDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fr-at">Au</Label>
            <Input
              id="fr-at"
              type="date"
              value={asAtDate}
              onChange={(e) => setAsAtDate(e.target.value)}
              required
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Calculer
            </Button>
            {query.data !== undefined ? (
              <Button type="button" variant="outline" onClick={downloadXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export
              </Button>
            ) : null}
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? <FinancialRatiosTable report={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function FinancialRatiosTable({ report }: { readonly report: FinancialRatiosReport }) {
  const groups = ['STRUCTURE', 'LIQUIDITE', 'SOLVABILITE', 'RENTABILITE', 'ACTIVITE'] as const;
  const labelByCategory: Record<(typeof groups)[number], string> = {
    STRUCTURE: 'Structure financière',
    LIQUIDITE: 'Liquidité',
    SOLVABILITE: 'Solvabilité',
    RENTABILITE: 'Rentabilité',
    ACTIVITE: 'Activité',
  };
  return (
    <div className="space-y-6">
      {groups.map((cat) => {
        const items = report.ratios.filter((r) => r.category === cat);
        if (items.length === 0) return null;
        return (
          <div key={cat}>
            <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
              {labelByCategory[cat]}
            </h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1">Code</th>
                  <th className="px-2 py-1">Ratio</th>
                  <th className="px-2 py-1">Formule</th>
                  <th className="px-2 py-1 text-right">Valeur</th>
                  <th className="px-2 py-1">Interprétation</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.code} className="border-b hover:bg-slate-50">
                    <td className="px-2 py-1 font-mono text-xs">{r.code}</td>
                    <td className="px-2 py-1 font-medium">{r.label}</td>
                    <td className="px-2 py-1 text-xs text-slate-500">{r.formula}</td>
                    <td className="px-2 py-1 text-right font-mono font-semibold">
                      {r.value === null
                        ? '—'
                        : r.unit === 'PERCENT'
                          ? `${r.value} %`
                          : r.unit === 'DAYS'
                            ? `${r.value} j`
                            : r.value}
                    </td>
                    <td className="px-2 py-1 text-xs text-slate-600">
                      {r.interpretation ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function fmt(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return amount;
  }
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
