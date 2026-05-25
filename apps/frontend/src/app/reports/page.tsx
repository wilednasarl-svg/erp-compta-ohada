'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, BookText, FileSpreadsheet, Loader2 } from 'lucide-react';
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
  ComparativeBalanceReport,
  GeneralLedgerReport,
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

type ReportMode = 'trial-balance' | 'comparative-balance' | 'general-ledger';

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

// ─── Helpers ───────────────────────────────────────────────────────────

function fmt(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return amount;
  }
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
