'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  BookText,
  Calculator,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  GitBranch,
  History,
  Info,
  Landmark,
  Layers,
  Loader2,
  Package,
  Stethoscope,
  TrendingUp,
  Wallet,
  XCircle,
} from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';

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
  AgingBalanceReport,
  AnalyticAxisSummary,
  AnnexeNoteDetailReport,
  AnnexeReport,
  CashTrendReport,
  ComparativeBalanceReport,
  FinancialRatiosReport,
  GeneralLedgerReport,
  ImportAnomalyGroup,
  ImportDiagnosticReport,
  ImportSessionSummary,
  MarginByAxisReport,
  MultiYearBalanceReport,
  SigReport,
  TafireReport,
  TftReport,
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
interface MultiYearBalanceEnvelope {
  readonly report: MultiYearBalanceReport;
}
interface AgingBalanceEnvelope {
  readonly report: AgingBalanceReport;
}
interface TafireEnvelope {
  readonly report: TafireReport;
}
interface TftEnvelope {
  readonly report: TftReport;
}
interface AnnexeEnvelope {
  readonly report: AnnexeReport;
}
interface MarginByAxisEnvelope {
  readonly report: MarginByAxisReport;
}
interface AnalyticAxesEnvelope {
  readonly axes: ReadonlyArray<AnalyticAxisSummary>;
}
interface ImportDiagnosticEnvelope {
  readonly report: ImportDiagnosticReport;
}
interface ImportSessionsEnvelope {
  readonly sessions: ReadonlyArray<ImportSessionSummary>;
}

type ReportMode =
  | 'trial-balance'
  | 'comparative-balance'
  | 'multi-year-balance'
  | 'sig'
  | 'ratios'
  | 'cash-trend'
  | 'aging-balance'
  | 'tafire'
  | 'tft'
  | 'annexe'
  | 'margin-by-axis'
  | 'general-ledger'
  | 'import-diagnostic';

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
          <Badge variant="outline">Module 9 — wave 3</Badge>
          <div className="ml-auto">
            <AnnualPackageButton orgId={orgId} />
          </div>
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
            onClick={() => setMode('multi-year-balance')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'multi-year-balance'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <History className="h-4 w-4" />
            Balance pluri-exercices
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
            onClick={() => setMode('aging-balance')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'aging-balance'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Clock className="h-4 w-4" />
            Balance âgée
          </button>
          <button
            type="button"
            onClick={() => setMode('tafire')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'tafire'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Landmark className="h-4 w-4" />
            TAFIRE
          </button>
          <button
            type="button"
            onClick={() => setMode('tft')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'tft'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <GitBranch className="h-4 w-4" />
            TFT
          </button>
          <button
            type="button"
            onClick={() => setMode('annexe')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'annexe'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FileText className="h-4 w-4" />
            Annexe
          </button>
          <button
            type="button"
            onClick={() => setMode('margin-by-axis')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'margin-by-axis'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Layers className="h-4 w-4" />
            Marge par activité
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
          <button
            type="button"
            onClick={() => setMode('import-diagnostic')}
            className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'import-diagnostic'
                ? 'bg-slate-900 text-white'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <Stethoscope className="h-4 w-4" />
            Diagnostic d&apos;import
          </button>
        </div>

        {mode === 'trial-balance' ? (
          <TrialBalancePanel orgId={orgId} />
        ) : mode === 'comparative-balance' ? (
          <ComparativeBalancePanel orgId={orgId} />
        ) : mode === 'multi-year-balance' ? (
          <MultiYearBalancePanel orgId={orgId} />
        ) : mode === 'sig' ? (
          <SigPanel orgId={orgId} />
        ) : mode === 'ratios' ? (
          <FinancialRatiosPanel orgId={orgId} />
        ) : mode === 'cash-trend' ? (
          <CashTrendPanel orgId={orgId} />
        ) : mode === 'aging-balance' ? (
          <AgingBalancePanel orgId={orgId} />
        ) : mode === 'tafire' ? (
          <TafirePanel orgId={orgId} />
        ) : mode === 'tft' ? (
          <TftPanel orgId={orgId} />
        ) : mode === 'annexe' ? (
          <AnnexePanel orgId={orgId} />
        ) : mode === 'margin-by-axis' ? (
          <MarginByAxisPanel orgId={orgId} />
        ) : mode === 'import-diagnostic' ? (
          <ImportDiagnosticPanel orgId={orgId} />
        ) : (
          <GeneralLedgerPanel orgId={orgId} />
        )}
      </div>
    </AppShell>
  );
}

// ─── Dossier annuel ZIP (générateur all-in-one) ────────────────────────

function AnnualPackageButton({ orgId }: { readonly orgId: string }) {
  const [open, setOpen] = useState<boolean>(false);
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [downloading, setDownloading] = useState<boolean>(false);

  const triggerDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      // Window.open avec URL avec params déclenche le download dans
      // l'onglet courant — l'attribut Content-Disposition côté backend
      // assure la sauvegarde sur disque sans naviguer.
      window.open(
        `/api/organizations/${orgId}/reports/annual-package.zip?${params.toString()}`,
        '_self',
      );
      setOpen(false);
    } finally {
      // Re-enable button after a brief delay — the download is async.
      setTimeout(() => setDownloading(false), 2000);
    }
  };

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="bg-emerald-600 hover:bg-emerald-700 text-white"
      >
        <Package className="mr-2 h-4 w-4" />
        Télécharger le dossier annuel
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border bg-white p-3 shadow-sm">
      <div className="space-y-1">
        <Label htmlFor="pkg-from" className="text-xs">
          Du
        </Label>
        <Input
          id="pkg-from"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="h-8"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="pkg-to" className="text-xs">
          Au
        </Label>
        <Input
          id="pkg-to"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="h-8"
        />
      </div>
      <Button
        onClick={triggerDownload}
        disabled={downloading}
        className="bg-emerald-600 hover:bg-emerald-700 text-white"
      >
        {downloading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Package className="mr-2 h-4 w-4" />
        )}
        Générer ZIP
      </Button>
      <Button variant="outline" onClick={() => setOpen(false)}>
        Annuler
      </Button>
    </div>
  );
}

// ─── Marge par axe analytique ──────────────────────────────────────────

function MarginByAxisPanel({ orgId }: { readonly orgId: string }) {
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [axisType, setAxisType] = useState<string>('CHANTIER');
  const [submitted, setSubmitted] = useState<{
    fromDate: string;
    toDate: string;
    axisType: string;
  } | null>(null);

  // Liste des axes disponibles pour suggérer les types existants
  const axesQuery = useQuery<ReadonlyArray<AnalyticAxisSummary>, ApiError>({
    queryKey: ['reports', 'analytic-axes', orgId],
    queryFn: async () => {
      const data = await api.get<AnalyticAxesEnvelope>(
        `/organizations/${orgId}/reports/analytic-axes`,
      );
      return data.axes;
    },
    enabled: orgId !== '',
  });
  const knownTypes = useMemo(
    () => Array.from(new Set((axesQuery.data ?? []).map((a) => a.axisType))),
    [axesQuery.data],
  );

  const buildParams = (s: NonNullable<typeof submitted>): URLSearchParams =>
    new URLSearchParams({
      fromDate: s.fromDate,
      toDate: s.toDate,
      axisType: s.axisType,
    });

  const query = useQuery<MarginByAxisReport, ApiError>({
    queryKey: ['reports', 'margin-by-axis', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<MarginByAxisEnvelope>(
        `/organizations/${orgId}/reports/margin-by-axis?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Marge par activité</CardTitle>
        <CardDescription>
          Décomposition de la marge brute et du résultat par axe analytique (chantier, BU,
          activité, projet). Seules les lignes d&apos;écriture imputées à un axe (champ
          analytic_axis_code) entrent dans le calcul. Pour utiliser ce rapport, imputez les
          écritures à l&apos;import via la colonne d&apos;axe ou en saisie manuelle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ fromDate, toDate, axisType });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="mba-axis">Type d&apos;axe</Label>
            <Input
              id="mba-axis"
              type="text"
              value={axisType}
              onChange={(e) => setAxisType(e.target.value.toUpperCase())}
              placeholder="CHANTIER"
              required
              list="known-axis-types"
            />
            {knownTypes.length > 0 ? (
              <datalist id="known-axis-types">
                {knownTypes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="mba-from">Du</Label>
            <Input
              id="mba-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mba-to">Au</Label>
            <Input
              id="mba-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer
            </Button>
          </div>
        </form>

        {axesQuery.data !== undefined && axesQuery.data.length === 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Aucune écriture imputée analytiquement pour le moment. Au prochain import,
            mappez une colonne du fichier sur le champ <code>analytic_axis_code</code> pour
            commencer à ventiler par chantier ou BU.
          </div>
        ) : null}

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? <MarginByAxisTable report={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function MarginByAxisTable({ report }: { readonly report: MarginByAxisReport }) {
  if (report.rows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Aucune écriture imputée sur l&apos;axe <strong>{report.axisType}</strong> pour cette
        période.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <th className="px-2 py-2">Axe</th>
            <th className="px-2 py-2 text-right">Chiffre d&apos;affaires</th>
            <th className="px-2 py-2 text-right">Achats consommés</th>
            <th className="px-2 py-2 text-right">Marge brute</th>
            <th className="px-2 py-2 text-right">% marge</th>
            <th className="px-2 py-2 text-right">Charges personnel</th>
            <th className="px-2 py-2 text-right">Autres charges</th>
            <th className="px-2 py-2 text-right">Résultat net</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => {
            const rn = Number(row.resultatNet);
            return (
              <tr key={row.axisCode} className="border-b hover:bg-slate-50">
                <td className="px-2 py-1 font-mono text-xs font-semibold">{row.axisCode}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.chiffreAffaires)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.achatsConsommes)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.margeBrute)}</td>
                <td className="px-2 py-1 text-right font-mono text-xs text-slate-500">
                  {row.margeBrutePercent !== null ? `${row.margeBrutePercent}%` : '—'}
                </td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.chargesPersonnel)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.autresCharges)}</td>
                <td
                  className={`px-2 py-1 text-right font-mono font-semibold ${rn < 0 ? 'text-red-600' : 'text-emerald-700'}`}
                >
                  {fmt(row.resultatNet)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 bg-slate-100 font-medium">
            <td className="px-2 py-2">TOTAL</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.chiffreAffaires)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.achatsConsommes)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.margeBrute)}</td>
            <td className="px-2 py-2 text-right font-mono text-xs text-slate-500">
              {report.totals.margeBrutePercent !== null ? `${report.totals.margeBrutePercent}%` : '—'}
            </td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.chargesPersonnel)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.autresCharges)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.resultatNet)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
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

  const queryClient = useQueryClient();
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

  const importChartMutation = useMutation<{ added: number; skipped: number }, ApiError>({
    mutationFn: async () => {
      return api.post<{ added: number; skipped: number }>(
        `/organizations/${orgId}/chart-of-accounts/import`,
        {},
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['chart-of-accounts', orgId] });
    },
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
                {accountsQuery.isLoading
                  ? '— Chargement du plan comptable… —'
                  : accountsQuery.isError
                    ? `— Erreur : ${accountsQuery.error?.message ?? 'plan indisponible'} —`
                    : (accountsQuery.data?.length ?? 0) === 0
                      ? "— Plan comptable vide (utiliser le bouton d'import) —"
                      : `— ${filteredAccounts.length} compte(s) disponible(s) —`}
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

        {accountsQuery.isSuccess && (accountsQuery.data?.length ?? 0) === 0 ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>
              Le plan comptable de cette organisation est vide. Importer le référentiel SYSCOHADA
              pour peupler les comptes.
            </span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => importChartMutation.mutate()}
              disabled={importChartMutation.isPending}
            >
              {importChartMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Importer le plan SYSCOHADA
            </Button>
            {importChartMutation.isSuccess ? (
              <span className="text-xs text-emerald-700">
                Importé : {importChartMutation.data.added} ajouté(s),{' '}
                {importChartMutation.data.skipped} ignoré(s).
              </span>
            ) : null}
          </div>
        ) : null}

        {accountsQuery.isError ? <FormError error={accountsQuery.error} /> : null}
        {importChartMutation.isError ? <FormError error={importChartMutation.error} /> : null}
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

// ─── Balance pluri-exercices ───────────────────────────────────────────

function MultiYearBalancePanel({ orgId }: { readonly orgId: string }) {
  const year = new Date().getFullYear();
  const [periods, setPeriods] = useState<Array<{ fromDate: string; toDate: string }>>([
    { fromDate: `${year - 2}-01-01`, toDate: `${year - 2}-12-31` },
    { fromDate: `${year - 1}-01-01`, toDate: `${year - 1}-12-31` },
    { fromDate: `${year}-01-01`, toDate: `${year}-12-31` },
  ]);
  const [submitted, setSubmitted] = useState<typeof periods | null>(null);

  const buildParams = (ps: typeof periods): URLSearchParams => {
    const p = new URLSearchParams();
    ps.forEach((per, i) => {
      p.set(`period${i + 1}FromDate`, per.fromDate);
      p.set(`period${i + 1}ToDate`, per.toDate);
    });
    return p;
  };

  const query = useQuery<MultiYearBalanceReport, ApiError>({
    queryKey: ['reports', 'multi-year-balance', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<MultiYearBalanceEnvelope>(
        `/organizations/${orgId}/reports/multi-year-balance?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    window.open(
      `/api/organizations/${orgId}/reports/multi-year-balance.xlsx?${buildParams(submitted).toString()}`,
      '_blank',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balance pluri-exercices</CardTitle>
        <CardDescription>
          Jusqu&apos;à 5 exercices côte à côte avec mouvement net par période + solde cumulé en
          fin de dernière période. Utile pour les audits et les comparaisons inter-exercices.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(periods);
          }}
        >
          {periods.map((p, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-1 flex items-center text-sm font-medium">
                Exercice {i + 1}
              </div>
              <Input
                type="date"
                value={p.fromDate}
                onChange={(e) =>
                  setPeriods(
                    periods.map((per, j) =>
                      j === i ? { fromDate: e.target.value, toDate: per.toDate } : per,
                    ),
                  )
                }
                required
              />
              <Input
                type="date"
                value={p.toDate}
                onChange={(e) =>
                  setPeriods(
                    periods.map((per, j) =>
                      j === i ? { fromDate: per.fromDate, toDate: e.target.value } : per,
                    ),
                  )
                }
                required
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            {periods.length < 5 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setPeriods([
                    { fromDate: `${year - periods.length}-01-01`, toDate: `${year - periods.length}-12-31` },
                    ...periods,
                  ])
                }
              >
                + Ajouter un exercice antérieur
              </Button>
            ) : null}
            {periods.length > 2 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setPeriods(periods.slice(1))}
              >
                − Retirer le plus ancien
              </Button>
            ) : null}
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer
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

        {query.data !== undefined ? <MultiYearBalanceTable report={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function MultiYearBalanceTable({ report }: { readonly report: MultiYearBalanceReport }) {
  if (report.rows.length === 0) {
    return <p className="text-sm text-slate-500">Aucun mouvement sur ces périodes.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <th className="px-2 py-2">Compte</th>
            <th className="px-2 py-2">Intitulé</th>
            {report.periods.map((p, i) => (
              <th key={i} className="px-2 py-2 text-right">
                Net {p.fromDate.slice(0, 4)}
              </th>
            ))}
            <th className="px-2 py-2 text-right">Solde Débit</th>
            <th className="px-2 py-2 text-right">Solde Crédit</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.accountId} className="border-b hover:bg-slate-50">
              <td className="px-2 py-1 font-mono text-xs">{row.accountCode}</td>
              <td className="px-2 py-1">{row.accountLabel}</td>
              {row.netByPeriod.map((n, i) => (
                <td key={i} className="px-2 py-1 text-right font-mono">
                  {fmt(n)}
                </td>
              ))}
              <td className="px-2 py-1 text-right font-mono">{fmt(row.endingDebit)}</td>
              <td className="px-2 py-1 text-right font-mono">{fmt(row.endingCredit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Balance âgée ──────────────────────────────────────────────────────

function AgingBalancePanel({ orgId }: { readonly orgId: string }) {
  const [side, setSide] = useState<'CLIENT' | 'FOURNISSEUR'>('CLIENT');
  const [asAtDate, setAsAtDate] = useState<string>(todayIso());
  const [bucketBoundaries, setBucketBoundaries] = useState<string>('30,60,90,180');
  const [submitted, setSubmitted] = useState<{
    side: 'CLIENT' | 'FOURNISSEUR';
    asAtDate: string;
    bucketBoundaries: string;
  } | null>(null);

  const buildParams = (s: NonNullable<typeof submitted>): URLSearchParams => {
    const p = new URLSearchParams({ side: s.side, asAtDate: s.asAtDate });
    if (s.bucketBoundaries.trim() !== '') p.set('bucketBoundaries', s.bucketBoundaries);
    return p;
  };

  const query = useQuery<AgingBalanceReport, ApiError>({
    queryKey: ['reports', 'aging-balance', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<AgingBalanceEnvelope>(
        `/organizations/${orgId}/reports/aging-balance?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    window.open(
      `/api/organizations/${orgId}/reports/aging-balance.xlsx?${buildParams(submitted).toString()}`,
      '_blank',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balance âgée</CardTitle>
        <CardDescription>
          Vieillissement des créances clients (411xxx) ou des dettes fournisseurs (401xxx) par
          buckets d&apos;âge. Imputation FIFO automatique des règlements sur les factures les
          plus anciennes (sans nécessiter de lettrage explicite). Buckets configurables.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ side, asAtDate, bucketBoundaries });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="ag-side">Tiers</Label>
            <select
              id="ag-side"
              value={side}
              onChange={(e) => setSide(e.target.value as 'CLIENT' | 'FOURNISSEUR')}
              className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            >
              <option value="CLIENT">Clients (411)</option>
              <option value="FOURNISSEUR">Fournisseurs (401)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ag-at">Au</Label>
            <Input
              id="ag-at"
              type="date"
              value={asAtDate}
              onChange={(e) => setAsAtDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ag-buckets">Buckets (jours)</Label>
            <Input
              id="ag-buckets"
              type="text"
              placeholder="30,60,90,180"
              value={bucketBoundaries}
              onChange={(e) => setBucketBoundaries(e.target.value)}
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

        {query.data !== undefined ? <AgingBalanceTable report={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function AgingBalanceTable({ report }: { readonly report: AgingBalanceReport }) {
  if (report.rows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Aucun en-cours {report.side === 'CLIENT' ? 'client' : 'fournisseur'} ouvert à cette date.
      </p>
    );
  }
  const bucketLabels = (report.rows[0]?.buckets ?? []).map((b) => b.label);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
            <th className="px-2 py-2">Compte</th>
            <th className="px-2 py-2">Intitulé</th>
            {bucketLabels.map((lab, i) => (
              <th key={i} className="px-2 py-2 text-right">
                {lab}
              </th>
            ))}
            <th className="px-2 py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.accountId} className="border-b hover:bg-slate-50">
              <td className="px-2 py-1 font-mono text-xs">{row.accountCode}</td>
              <td className="px-2 py-1">{row.accountLabel}</td>
              {row.buckets.map((b, i) => (
                <td
                  key={i}
                  className={`px-2 py-1 text-right font-mono ${i === row.buckets.length - 1 && Number(b.amount) > 0 ? 'text-red-600 font-semibold' : ''}`}
                >
                  {fmt(b.amount)}
                </td>
              ))}
              <td className="px-2 py-1 text-right font-mono font-semibold">{fmt(row.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 bg-slate-100 font-medium">
            <td className="px-2 py-2" colSpan={2}>
              TOTAUX
            </td>
            {report.bucketTotals.map((t, i) => (
              <td key={i} className="px-2 py-2 text-right font-mono">
                {fmt(t)}
              </td>
            ))}
            <td className="px-2 py-2 text-right font-mono">{fmt(report.grandTotal)}</td>
          </tr>
        </tfoot>
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

// ─── TAFIRE ────────────────────────────────────────────────────────────

function TafirePanel({ orgId }: { readonly orgId: string }) {
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [submitted, setSubmitted] = useState<{ fromDate: string; toDate: string } | null>(null);

  const buildParams = (s: NonNullable<typeof submitted>): URLSearchParams =>
    new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate });

  const query = useQuery<TafireReport, ApiError>({
    queryKey: ['reports', 'tafire', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<TafireEnvelope>(
        `/organizations/${orgId}/reports/tafire?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    window.open(
      `/api/organizations/${orgId}/reports/tafire.xlsx?${buildParams(submitted).toString()}`,
      '_blank',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>TAFIRE — Tableau Financier des Ressources et Emplois</CardTitle>
        <CardDescription>
          État OHADA obligatoire pour les grandes entreprises (Vol. 3 SYSCOHADA AUDCIF).
          EMPLOIS : investissements + variation BFR + remboursements dettes.
          RESSOURCES : CAF + cessions + augmentations capitaux/dettes. CAF calculée
          automatiquement à partir du SIG.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ fromDate, toDate });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="taf-from">Du</Label>
            <Input
              id="taf-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="taf-to">Au</Label>
            <Input
              id="taf-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer
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

        {query.data !== undefined ? <TafireTable report={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function TafireTable({ report }: { readonly report: TafireReport }) {
  const sumOf = (sections: ReadonlyArray<{ readonly total: string }>): string =>
    sections.reduce((s, sec) => s + Number(sec.total), 0).toFixed(2);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total EMPLOIS" value={sumOf(report.emplois)} />
        <SummaryCard label="Total RESSOURCES" value={sumOf(report.ressources)} />
        <SummaryCard label="Variation Trésorerie" value={report.variationTresorerie} />
      </div>
      <OhadaStatementBlock
        title="EMPLOIS"
        sections={report.emplois}
        titleClass="text-red-700"
      />
      <OhadaStatementBlock
        title="RESSOURCES"
        sections={report.ressources}
        titleClass="text-emerald-700"
      />
      {report.methodologyNotes.length > 0 ? (
        <details className="rounded-md border bg-slate-50 p-3 text-xs text-slate-700">
          <summary className="cursor-pointer font-medium">Notes méthodologiques</summary>
          <ul className="mt-2 list-disc pl-4 space-y-1">
            {report.methodologyNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// ─── TFT ───────────────────────────────────────────────────────────────

function TftPanel({ orgId }: { readonly orgId: string }) {
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [submitted, setSubmitted] = useState<{ fromDate: string; toDate: string } | null>(null);

  const buildParams = (s: NonNullable<typeof submitted>): URLSearchParams =>
    new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate });

  const query = useQuery<TftReport, ApiError>({
    queryKey: ['reports', 'tft', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<TftEnvelope>(
        `/organizations/${orgId}/reports/tft?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    window.open(
      `/api/organizations/${orgId}/reports/tft.xlsx?${buildParams(submitted).toString()}`,
      '_blank',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>TFT — Tableau de Flux de Trésorerie (méthode indirecte)</CardTitle>
        <CardDescription>
          Décomposition des variations de trésorerie en 3 catégories OHADA :
          activités d&apos;exploitation, d&apos;investissement, de financement.
          Méthode indirecte (à partir du résultat net + ajustements non-cash).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ fromDate, toDate });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="tft-from">Du</Label>
            <Input
              id="tft-from"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="tft-to">Au</Label>
            <Input
              id="tft-to"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer
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

        {query.data !== undefined ? <TftTable report={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function TftTable({ report }: { readonly report: TftReport }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Trésorerie ouverture" value={report.tresorerieOuverture} />
        <SummaryCard label="Variation totale" value={report.variationTresorerie} />
        <SummaryCard label="Trésorerie clôture" value={report.tresorerieCloture} />
      </div>
      <OhadaStatementBlock
        title="Activités d'exploitation"
        sections={[report.fluxExploitation]}
        titleClass="text-blue-700"
      />
      <OhadaStatementBlock
        title="Activités d'investissement"
        sections={[report.fluxInvestissement]}
        titleClass="text-amber-700"
      />
      <OhadaStatementBlock
        title="Activités de financement"
        sections={[report.fluxFinancement]}
        titleClass="text-purple-700"
      />
      {report.methodologyNotes.length > 0 ? (
        <details className="rounded-md border bg-slate-50 p-3 text-xs text-slate-700">
          <summary className="cursor-pointer font-medium">Notes méthodologiques</summary>
          <ul className="mt-2 list-disc pl-4 space-y-1">
            {report.methodologyNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// ─── Annexe ────────────────────────────────────────────────────────────

function AnnexePanel({ orgId }: { readonly orgId: string }) {
  const [asAtDate, setAsAtDate] = useState<string>(todayIso());
  const [fiscalYearStartDate, setFiscalYearStartDate] = useState<string>(yearStartIso());
  const [submitted, setSubmitted] = useState<{
    asAtDate: string;
    fiscalYearStartDate: string;
  } | null>(null);

  const buildParams = (s: NonNullable<typeof submitted>): URLSearchParams =>
    new URLSearchParams({ asAtDate: s.asAtDate, fiscalYearStartDate: s.fiscalYearStartDate });

  const query = useQuery<AnnexeReport, ApiError>({
    queryKey: ['reports', 'annexe', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<AnnexeEnvelope>(
        `/organizations/${orgId}/reports/annexe?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    window.open(
      `/api/organizations/${orgId}/reports/annexe.xlsx?${buildParams(submitted).toString()}`,
      '_blank',
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Annexe — Notes 1 à 36 SYSCOHADA AUDCIF</CardTitle>
        <CardDescription>
          Liste des 35+ notes obligatoires des états financiers annuels OHADA. Chaque
          note est marquée selon son statut : <strong>COMPUTED</strong> (calculable
          depuis un rapport source), <strong>PARTIAL</strong> (partielle, à compléter),
          <strong>MANUAL</strong> (saisie comptable).
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
            <Label htmlFor="anx-fy">Début exercice</Label>
            <Input
              id="anx-fy"
              type="date"
              value={fiscalYearStartDate}
              onChange={(e) => setFiscalYearStartDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="anx-at">Au</Label>
            <Input
              id="anx-at"
              type="date"
              value={asAtDate}
              onChange={(e) => setAsAtDate(e.target.value)}
              required
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={query.isFetching}>
              {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Générer
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

        {query.data !== undefined ? <AnnexeTable report={query.data} orgId={orgId} /> : null}
      </CardContent>
    </Card>
  );
}

function AnnexeTable({
  report,
  orgId,
}: {
  readonly report: AnnexeReport;
  readonly orgId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const statusColors: Record<'COMPUTED' | 'PARTIAL' | 'MANUAL', string> = {
    COMPUTED: 'bg-emerald-100 text-emerald-800',
    PARTIAL: 'bg-amber-100 text-amber-800',
    MANUAL: 'bg-slate-200 text-slate-700',
  };
  const counts = report.notes.reduce(
    (acc, n) => ({ ...acc, [n.status]: (acc[n.status] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  const supportedNotes = new Set([
    'Note 3A',
    'Note 3B',
    'Note 5',
    'Note 14',
    'Note 15',
    'Note 20',
    'Note 28',
  ]);
  return (
    <div className="space-y-4">
      <div className="flex gap-3 text-xs">
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
          {counts.COMPUTED ?? 0} COMPUTED
        </span>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">
          {counts.PARTIAL ?? 0} PARTIAL
        </span>
        <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-700">
          {counts.MANUAL ?? 0} MANUAL
        </span>
        <span className="text-slate-500">
          • Cliquer sur une note pour afficher son détail (7 notes implémentées : 3A, 3B, 5, 14, 15, 20, 28)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <th className="px-2 py-2">Note</th>
              <th className="px-2 py-2">Titre</th>
              <th className="px-2 py-2">Statut</th>
              <th className="px-2 py-2">Source / Référence</th>
            </tr>
          </thead>
          <tbody>
            {report.notes.map((n) => {
              const supported = supportedNotes.has(n.code);
              const isExpanded = expanded === n.code;
              return (
                <Fragment key={n.code}>
                  <tr
                    className={`border-b ${supported ? 'cursor-pointer hover:bg-slate-100' : 'hover:bg-slate-50'} ${isExpanded ? 'bg-slate-50' : ''}`}
                    onClick={() => {
                      if (supported) setExpanded(isExpanded ? null : n.code);
                    }}
                  >
                    <td className="px-2 py-1 font-mono text-xs font-semibold">
                      {supported ? (isExpanded ? '▼ ' : '▶ ') : '  '}
                      {n.code}
                    </td>
                    <td className="px-2 py-1">{n.title}</td>
                    <td className="px-2 py-1">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[n.status]}`}
                      >
                        {n.status}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-xs text-slate-500">{n.source ?? '—'}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="border-b bg-slate-50">
                      <td colSpan={4} className="px-4 py-3">
                        <AnnexeNoteDetailInline
                          orgId={orgId}
                          noteCode={n.code}
                          asAtDate={report.asAtDate}
                          fiscalYearStartDate={report.fiscalYearStartDate}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnnexeNoteDetailInline({
  orgId,
  noteCode,
  asAtDate,
  fiscalYearStartDate,
}: {
  readonly orgId: string;
  readonly noteCode: string;
  readonly asAtDate: string;
  readonly fiscalYearStartDate: string;
}) {
  const detailQuery = useQuery<AnnexeNoteDetailReport, ApiError>({
    queryKey: ['reports', 'annexe-note', orgId, noteCode, asAtDate, fiscalYearStartDate],
    queryFn: async () => {
      const params = new URLSearchParams({
        noteCode,
        asAtDate,
        fiscalYearStartDate,
      });
      const data = await api.get<{ report: AnnexeNoteDetailReport }>(
        `/organizations/${orgId}/reports/annexe/note?${params.toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '',
  });

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Chargement du détail…
      </div>
    );
  }
  if (detailQuery.isError) {
    return <FormError error={detailQuery.error} />;
  }
  const detail = detailQuery.data;
  if (detail === undefined) return null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h5 className="text-sm font-semibold">{detail.title}</h5>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            detail.coverage === 'COMPLETE'
              ? 'bg-emerald-100 text-emerald-800'
              : detail.coverage === 'PARTIAL'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-200 text-slate-700'
          }`}
        >
          {detail.coverage}
        </span>
      </div>
      {detail.rows.length === 0 ? (
        <p className="text-xs text-slate-500">Aucune donnée pour cette note.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-slate-500">
              <th className="px-2 py-1">Code</th>
              <th className="px-2 py-1">Libellé</th>
              <th className="px-2 py-1 text-right">Montant</th>
            </tr>
          </thead>
          <tbody>
            {detail.rows.map((r) => (
              <Fragment key={r.code}>
                <tr className="border-b font-medium">
                  <td className="px-2 py-1 font-mono">{r.code}</td>
                  <td className="px-2 py-1">{r.label}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(r.amount)}</td>
                </tr>
                {r.subRows?.map((sr) => (
                  <tr key={sr.code} className="border-b text-slate-600">
                    <td className="px-2 py-1 pl-6 font-mono">{sr.code}</td>
                    <td className="px-2 py-1 pl-6">{sr.label}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(sr.amount)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="border-t-2 bg-slate-100 font-semibold">
              <td className="px-2 py-1" colSpan={2}>
                Total
              </td>
              <td className="px-2 py-1 text-right font-mono">{fmt(detail.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {detail.methodology !== undefined ? (
        <p className="text-xs italic text-slate-500">{detail.methodology}</p>
      ) : null}
    </div>
  );
}

// ─── Bloc réutilisable de section OHADA ────────────────────────────────

function OhadaStatementBlock({
  title,
  sections,
  titleClass = '',
}: {
  readonly title: string;
  readonly sections: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly total: string;
    readonly lines: ReadonlyArray<{ readonly code: string; readonly label: string; readonly amount: string }>;
  }>;
  readonly titleClass?: string;
}) {
  return (
    <div>
      <h4 className={`mb-2 text-sm font-semibold uppercase tracking-wide ${titleClass}`}>
        {title}
      </h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1">Réf.</th>
            <th className="px-2 py-1">Libellé</th>
            <th className="px-2 py-1 text-right">Montant</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section.code}>
              <tr className="border-b bg-slate-50">
                <td className="px-2 py-1 font-mono text-xs font-semibold">{section.code}</td>
                <td className="px-2 py-1 font-medium" colSpan={2}>
                  {section.label}
                </td>
              </tr>
              {section.lines.map((line) => (
                <tr key={line.code} className="border-b">
                  <td className="px-2 py-1 font-mono text-xs text-slate-500">{line.code}</td>
                  <td className="px-2 py-1 pl-6 text-xs">{line.label}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(line.amount)}</td>
                </tr>
              ))}
              <tr className="border-b font-semibold">
                <td className="px-2 py-1"></td>
                <td className="px-2 py-1 text-right text-xs">Total {section.label}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(section.total)}</td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Diagnostic d'import ────────────────────────────────────────────────

/**
 * Pre-flight check d'une session d'import : balance des comptes telle
 * qu'elle résulterait du commit, anomalies classées par sévérité, plan
 * de normalisation actionnable. Lit le staging, PAS les journaux validés.
 */
function ImportDiagnosticPanel({ orgId }: { readonly orgId: string }) {
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');

  const sessionsQuery = useQuery<ImportSessionsEnvelope, ApiError>({
    queryKey: ['imports', 'sessions', orgId],
    queryFn: () => api.get<ImportSessionsEnvelope>(`/organizations/${orgId}/imports/sessions`),
    enabled: orgId !== '',
  });

  const eligibleSessions = useMemo(() => {
    const sessions = sessionsQuery.data?.sessions ?? [];
    return sessions.filter((s) =>
      ['parsed', 'validated', 'ready_for_import', 'completed'].includes(s.status),
    );
  }, [sessionsQuery.data]);

  // Auto-select the most recent eligible session (no useEffect needed —
  // derived state: explicit selection wins, otherwise fall back to head).
  const activeSessionId =
    selectedSessionId !== '' ? selectedSessionId : (eligibleSessions[0]?.id ?? '');

  const diagQuery = useQuery<ImportDiagnosticReport, ApiError>({
    queryKey: ['reports', 'import-diagnostic', orgId, activeSessionId],
    queryFn: async () => {
      const env = await api.get<ImportDiagnosticEnvelope>(
        `/organizations/${orgId}/reports/import-diagnostic/${activeSessionId}`,
      );
      return env.report;
    },
    enabled: orgId !== '' && activeSessionId !== '',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="h-5 w-5" />
          Diagnostic d&apos;import
        </CardTitle>
        <CardDescription>
          Scan de santé d&apos;une session d&apos;import : balance prévisionnelle, points de vigilance,
          anomalies bloquantes et plan de normalisation pour rendre le fichier conforme OHADA.
          Cette analyse porte sur les lignes en staging — AVANT le commit en comptabilité.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sélecteur de session */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[280px]">
            <Label htmlFor="diag-session">Session d&apos;import</Label>
            <select
              id="diag-session"
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              value={activeSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              disabled={sessionsQuery.isPending || eligibleSessions.length === 0}
            >
              {eligibleSessions.length === 0 && (
                <option value="">— aucune session éligible —</option>
              )}
              {eligibleSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatSessionLabel(s)}
                </option>
              ))}
            </select>
          </div>
          {diagQuery.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-label="chargement" />
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (activeSessionId === '') return;
              window.open(
                `/api/organizations/${orgId}/reports/import-diagnostic/${activeSessionId}.pdf`,
                '_blank',
              );
            }}
            disabled={activeSessionId === '' || diagQuery.data === undefined}
          >
            <FileText className="mr-2 h-4 w-4" />
            Télécharger PDF
          </Button>
        </div>

        {sessionsQuery.isError ? <FormError error={sessionsQuery.error} /> : null}
        {diagQuery.isError ? <FormError error={diagQuery.error} /> : null}

        {sessionsQuery.isSuccess && eligibleSessions.length === 0 && (
          <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Aucune session d&apos;import éligible. Charge un fichier dans l&apos;onglet{' '}
            <em>Imports</em> et lance la validation pour le voir apparaître ici.
          </div>
        )}

        {diagQuery.data !== undefined && (
          <>
            <VerdictBanner report={diagQuery.data} />
            <ImportTrialBalanceTable report={diagQuery.data} />
            <AnomalySection anomalies={diagQuery.data.anomalies} />
            {diagQuery.data.remediationPlan.length > 0 && (
              <RemediationPlanCard items={diagQuery.data.remediationPlan} />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function formatSessionLabel(s: ImportSessionSummary): string {
  const date = new Date(s.createdAt).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const docType = s.documentType !== null ? ` — ${s.documentType}` : '';
  const label = s.label !== null && s.label !== '' ? s.label : `Session ${s.id.slice(0, 8)}`;
  return `${date} · ${label}${docType} (${s.status}, ${s.totalLines} lignes)`;
}

function VerdictBanner({ report }: { readonly report: ImportDiagnosticReport }) {
  const { verdict, totals } = report;
  const palette =
    verdict.status === 'conforme'
      ? { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-900', icon: CheckCircle2, iconColor: 'text-emerald-600' }
      : verdict.status === 'à corriger'
      ? { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-900', icon: AlertTriangle, iconColor: 'text-amber-600' }
      : { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-900', icon: XCircle, iconColor: 'text-rose-600' };
  const Icon = palette.icon;
  return (
    <div className={`rounded-lg border ${palette.border} ${palette.bg} p-4`}>
      <div className="flex items-start gap-3">
        <Icon className={`h-6 w-6 ${palette.iconColor} flex-shrink-0 mt-0.5`} />
        <div className={`${palette.text} flex-1`}>
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-lg font-semibold capitalize">{verdict.status}</span>
            <span className="text-sm">
              {verdict.criticalCount} critique{verdict.criticalCount > 1 ? 's' : ''} ·{' '}
              {verdict.warningCount} avertissement{verdict.warningCount > 1 ? 's' : ''} ·{' '}
              {verdict.infoCount} info
            </span>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <span className="font-medium">Total débit&nbsp;:</span> {fmt(totals.totalDebit)} FCFA
            </div>
            <div>
              <span className="font-medium">Total crédit&nbsp;:</span> {fmt(totals.totalCredit)} FCFA
            </div>
            <div className={totals.isBalanced ? '' : 'font-semibold'}>
              <span className="font-medium">Écart&nbsp;:</span>{' '}
              {totals.isBalanced ? '0,00 (équilibré ✓)' : `${fmt(totals.balanceDelta)} FCFA`}
            </div>
          </div>
          <div className="mt-2 text-xs">
            {verdict.canCommit
              ? '✓ Cette session peut être committée. Les avertissements méritent un coup d\'œil mais ne bloquent pas.'
              : '⚠ Cette session ne peut PAS être committée en l\'état. Corriger les anomalies critiques ci-dessous.'}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportTrialBalanceTable({ report }: { readonly report: ImportDiagnosticReport }) {
  if (report.trialBalance.length === 0) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        Aucune ligne de balance — la session ne contient pas d&apos;écritures parsables.
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 font-semibold">Balance des comptes (prévisionnelle)</h3>
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Compte</th>
              <th className="px-3 py-2 text-left font-medium">Libellé</th>
              <th className="px-3 py-2 text-right font-medium">Lignes</th>
              <th className="px-3 py-2 text-right font-medium">Débit</th>
              <th className="px-3 py-2 text-right font-medium">Crédit</th>
              <th className="px-3 py-2 text-right font-medium">Solde</th>
              <th className="px-3 py-2 text-left font-medium">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {report.trialBalance.map((row) => (
              <tr key={row.accountCode}>
                <td className="px-3 py-2 font-mono">{row.accountCode}</td>
                <td className="px-3 py-2">{row.accountLabel}</td>
                <td className="px-3 py-2 text-right">{row.lineCount}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(row.debit)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(row.credit)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {fmt(row.balance)} {row.sign}
                </td>
                <td className="px-3 py-2">
                  {row.accountExists ? (
                    <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                      existant
                    </Badge>
                  ) : row.autoProvisionable ? (
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      auto-créé au commit
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-rose-300 text-rose-700">
                      inconnu
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold">
            <tr>
              <td colSpan={3} className="px-3 py-2 text-right">
                TOTAUX
              </td>
              <td className="px-3 py-2 text-right font-mono">{fmt(report.totals.totalDebit)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmt(report.totals.totalCredit)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {report.totals.isBalanced ? '— équilibré' : fmt(report.totals.balanceDelta)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function AnomalySection({
  anomalies,
}: {
  readonly anomalies: ImportDiagnosticReport['anomalies'];
}) {
  const total = anomalies.critical.length + anomalies.warnings.length + anomalies.info.length;
  if (total === 0) {
    return (
      <div className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        ✓ Aucune anomalie détectée — le fichier est techniquement conforme.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <h3 className="font-semibold">Anomalies détectées</h3>
      {anomalies.critical.length > 0 && (
        <AnomalyGroupList
          title="Bloquants (à corriger impérativement avant commit)"
          severity="critical"
          groups={anomalies.critical}
        />
      )}
      {anomalies.warnings.length > 0 && (
        <AnomalyGroupList
          title="Avertissements (recommandé de vérifier)"
          severity="warning"
          groups={anomalies.warnings}
        />
      )}
      {anomalies.info.length > 0 && (
        <AnomalyGroupList
          title="Informations"
          severity="info"
          groups={anomalies.info}
        />
      )}
    </div>
  );
}

function AnomalyGroupList({
  title,
  severity,
  groups,
}: {
  readonly title: string;
  readonly severity: 'critical' | 'warning' | 'info';
  readonly groups: ReadonlyArray<ImportAnomalyGroup>;
}) {
  const palette =
    severity === 'critical'
      ? { border: 'border-rose-200', bg: 'bg-rose-50', icon: XCircle, iconColor: 'text-rose-600' }
      : severity === 'warning'
      ? { border: 'border-amber-200', bg: 'bg-amber-50', icon: AlertTriangle, iconColor: 'text-amber-600' }
      : { border: 'border-slate-200', bg: 'bg-slate-50', icon: Info, iconColor: 'text-slate-600' };
  const Icon = palette.icon;
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-slate-700">{title}</h4>
      <div className="space-y-2">
        {groups.map((g) => (
          <details key={g.code} className={`rounded border ${palette.border} ${palette.bg} p-3`}>
            <summary className="cursor-pointer text-sm">
              <span className="inline-flex items-center gap-2 align-middle">
                <Icon className={`h-4 w-4 ${palette.iconColor}`} />
                <span className="font-semibold">{g.title}</span>
                <Badge variant="outline">
                  {g.count} ligne{g.count > 1 ? 's' : ''}
                </Badge>
              </span>
            </summary>
            <div className="mt-2 text-sm text-slate-700">
              <p>{g.description}</p>
              {g.samples.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-medium uppercase text-slate-500">
                    Exemples ({g.samples.length} sur {g.count})
                  </span>
                  <ul className="mt-1 space-y-1 text-xs text-slate-700">
                    {g.samples.map((s, i) => (
                      <li key={`${g.code}-${i}`} className="font-mono">
                        Ligne {s.rowNumber}
                        {s.accountCode !== null ? ` · compte ${s.accountCode}` : ''}
                        {s.field !== undefined ? ` · champ ${s.field}` : ''} —{' '}
                        <span className="font-sans">{s.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function RemediationPlanCard({
  items,
}: {
  readonly items: ImportDiagnosticReport['remediationPlan'];
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        <BookText className="h-4 w-4" />
        Plan de normalisation — ce qu&apos;il faut faire
      </h3>
      <ol className="space-y-3 text-sm">
        {items.map((item, idx) => (
          <li key={`${item.title}-${idx}`} className="flex gap-3">
            <Badge
              variant="outline"
              className={
                item.priority === 1
                  ? 'border-rose-300 text-rose-700'
                  : item.priority === 2
                  ? 'border-amber-300 text-amber-700'
                  : 'border-slate-300 text-slate-700'
              }
            >
              P{item.priority}
            </Badge>
            <div className="flex-1">
              <div className="font-medium">
                {item.title}{' '}
                <span className="text-xs font-normal text-slate-500">
                  · {item.affectedCount} ligne{item.affectedCount > 1 ? 's' : ''}
                </span>
                {item.autoFixable && (
                  <Badge variant="outline" className="ml-2 border-emerald-300 text-emerald-700">
                    auto-fix
                  </Badge>
                )}
              </div>
              <p className="text-slate-600">{item.description}</p>
            </div>
          </li>
        ))}
      </ol>
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
