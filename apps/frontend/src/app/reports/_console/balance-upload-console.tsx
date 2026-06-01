'use client';

/**
 * Balance personnalisée — upload d'une balance CSV/Excel pour générer Bilan et
 * Compte de résultat SYSCOHADA sans passer par les écritures validées (reprise
 * d'antériorité, simulation). Port fidèle du panneau legacy `BalanceUploadPanel`
 * de `reports/page.tsx`, rendu autonome (sans dépendance au monolithe) pour
 * éviter les conflits avec le travail parallèle.
 *
 * IMPORTANT : le Bilan/CR officiel vient du BACKEND
 * (`POST /organizations/:orgId/reports/from-balance`). On n'affiche QUE ce que
 * le backend renvoie. Les sommes côté client (`totalDebit/totalCredit`,
 * `isBalanced`) sont UNIQUEMENT un contrôle d'équilibre du fichier uploadé
 * (preview de parsing).
 */

import { useMutation } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownUp,
  BarChart3,
  BookText,
  CheckCircle2,
  Columns3,
  Download,
  FileSpreadsheet,
  Info,
  Layers,
  Loader2,
  Percent,
  PieChart,
  Printer,
  Scale,
  Table2,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type {
  AnnexeReport,
  BalanceSheetReport,
  CashFlowReport,
  ComparativeBalanceReport,
  FinancialRatiosReport,
  MultiYearBalanceReport,
  ProfitLossReport,
  SigReport,
  TrialBalanceReport,
} from '@/types/reports';

import { AnnexeResult } from './annexe-result';
import { BalanceSheetResult } from './balance-sheet-result';
import { type BalanceParsed, parseBalanceCsv, parseBalanceXlsx } from './balance-parse';
import { type BalanceInventoryType, BalanceTypeSelector } from './balance-type-selector';
import { ComparativeResult } from './comparative-result';
import { MultiYearResult } from './multi-year-result';
import { PreviousBalancesUpload } from './previous-balances-upload';
import { todayIso, yearStartIso } from './presets';
import { ProfitLossResult } from './profit-loss-result';
import { RatiosResult } from './ratios-result';
import { SigResult } from './sig-result';
import { type StockBreakdown, StockBreakdownNote } from './stock-breakdown-note';
import { TftResult } from './tft-result';
import { TrialBalanceResult } from './trial-balance-result';

interface UnusualBalanceRow {
  code: string;
  label: string;
  amount: string;
  sign: 'D' | 'C';
  severity: 'warning' | 'info';
  reason: string;
}

interface FromBalanceResult {
  bilan: BalanceSheetReport;
  cr: ProfitLossReport;
  unusualBalances: UnusualBalanceRow[];
  stockBreakdown: StockBreakdown;
  trialBalance: TrialBalanceReport;
  sig: SigReport;
  ratios: FinancialRatiosReport;
  annexe: AnnexeReport | null;
  comparative: ComparativeBalanceReport | null;
  tft: CashFlowReport | null;
  multiYear: MultiYearBalanceReport | null;
}

type ResultTab =
  | 'bilan'
  | 'cr'
  | 'sig'
  | 'ratios'
  | 'balance'
  | 'annexe'
  | 'comparative'
  | 'multiyear'
  | 'tft';

const RESULT_TABS: ReadonlyArray<{ key: ResultTab; label: string; Icon: typeof Scale }> = [
  { key: 'bilan', label: 'Bilan', Icon: Scale },
  { key: 'cr', label: 'Compte de résultat', Icon: PieChart },
  { key: 'sig', label: 'SIG', Icon: BarChart3 },
  { key: 'ratios', label: 'Ratios', Icon: Percent },
  { key: 'balance', label: 'Balance générale', Icon: Table2 },
  { key: 'annexe', label: 'Annexe', Icon: BookText },
  { key: 'comparative', label: 'Comparative', Icon: Columns3 },
  { key: 'multiyear', label: 'Pluriannuelle', Icon: Layers },
  { key: 'tft', label: 'TFT', Icon: ArrowDownUp },
];

const fmt = (amount: string): string => {
  const n = Number(amount);
  if (!Number.isFinite(n)) {
    return amount;
  }
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// ─── Sous-composant local (port du legacy `FilterGroup`) ─────────────────────

function FilterGroup({
  title,
  subtitle,
  children,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-2xs uppercase tracking-wider text-ink-mute">
        {title}
        <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-mute/80">
          · {subtitle}
        </span>
      </legend>
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function BalanceUploadConsole({ orgId }: { readonly orgId: string }) {
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<BalanceParsed | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [asAtDate, setAsAtDate] = useState(todayIso());
  const [fyStart, setFyStart] = useState(yearStartIso());
  const [incorporateResult, setIncorporateResult] = useState(true);
  const [balanceType, setBalanceType] = useState<BalanceInventoryType>('apres-inventaire');
  const [activeTab, setActiveTab] = useState<ResultTab>('bilan');
  const [showAllRows, setShowAllRows] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Balances antérieures (optionnelles) — débloquent Comparative/Pluriannuelle/TFT.
  const [parsedPrev, setParsedPrev] = useState<BalanceParsed | null>(null);
  const [prevAsAtDate, setPrevAsAtDate] = useState('');
  const [parsedPrev2, setParsedPrev2] = useState<BalanceParsed | null>(null);
  const [prev2AsAtDate, setPrev2AsAtDate] = useState('');
  const [prevParseError, setPrevParseError] = useState<string | null>(null);

  const mutation = useMutation<FromBalanceResult>({
    mutationFn: async () => {
      if (!parsed) throw new Error('Aucune donnée');
      return api.post<FromBalanceResult>(`/organizations/${orgId}/reports/from-balance`, {
        rows: parsed.rows,
        asAtDate,
        ...(incorporateResult ? { fiscalYearStartDate: fyStart } : {}),
        ...(parsedPrev ? { previousRows: parsedPrev.rows, previousAsAtDate: prevAsAtDate } : {}),
        ...(parsedPrev2
          ? { previous2Rows: parsedPrev2.rows, previous2AsAtDate: prev2AsAtDate }
          : {}),
      });
    },
  });

  const parseFile = async (f: File): Promise<BalanceParsed> => {
    const isExcel =
      /\.(xlsx|xls)$/i.test(f.name) ||
      f.type.includes('spreadsheetml') ||
      f.type.includes('ms-excel');
    if (isExcel) {
      const buffer = await f.arrayBuffer();
      return parseBalanceXlsx(buffer);
    }
    const text = await f.text();
    return parseBalanceCsv(text);
  };

  const handleFile = async (f: File): Promise<void> => {
    try {
      const result = await parseFile(f);
      setParsed(result);
      setParseError(null);
      setShowAllRows(false);
      mutation.reset();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Erreur de lecture du fichier.');
      setParsed(null);
    }
  };

  const handlePrevFile = async (f: File): Promise<void> => {
    try {
      const result = await parseFile(f);
      setParsedPrev(result);
      setPrevParseError(null);
      mutation.reset();
    } catch (e) {
      setPrevParseError(
        e instanceof Error ? e.message : 'Erreur de lecture du fichier (balance N-1).',
      );
      setParsedPrev(null);
    }
  };

  const handlePrev2File = async (f: File): Promise<void> => {
    try {
      const result = await parseFile(f);
      setParsedPrev2(result);
      setPrevParseError(null);
      mutation.reset();
    } catch (e) {
      setPrevParseError(
        e instanceof Error ? e.message : 'Erreur de lecture du fichier (balance N-2).',
      );
      setParsedPrev2(null);
    }
  };

  const isBalanced =
    parsed !== null ? Math.abs(parsed.totalDebit - parsed.totalCredit) < 1 : null;

  const exportBalanceCsv = (): void => {
    if (!parsed) return;
    const header = 'Compte;Libellé;Solde Débiteur;Solde Créditeur\n';
    const body = parsed.rows
      .map((r) => `${r.code};${r.label};${r.debit.replace('.', ',')};${r.credit.replace('.', ',')}`)
      .join('\n');
    const blob = new Blob(['﻿' + header + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `balance-${asAtDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportBalanceXls = (): void => {
    if (!parsed) return;
    const escape = (s: string): string =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const headerRow =
      '<Row>' +
      ['Compte', 'Libellé', 'Solde Débiteur', 'Solde Créditeur']
        .map((h) => `<Cell><Data ss:Type="String">${escape(h)}</Data></Cell>`)
        .join('') +
      '</Row>';
    const dataRows = parsed.rows
      .map(
        (r) =>
          '<Row>' +
          `<Cell><Data ss:Type="String">${escape(r.code)}</Data></Cell>` +
          `<Cell><Data ss:Type="String">${escape(r.label)}</Data></Cell>` +
          `<Cell><Data ss:Type="Number">${Number(r.debit)}</Data></Cell>` +
          `<Cell><Data ss:Type="Number">${Number(r.credit)}</Data></Cell>` +
          '</Row>',
      )
      .join('\n');
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Worksheet ss:Name="Balance">',
      '<Table>',
      headerRow,
      dataRows,
      '</Table>',
      '</Worksheet>',
      '</Workbook>',
    ].join('\n');
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `balance-${asAtDate}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mutationErrorMessage =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.error instanceof Error
        ? mutation.error.message
        : 'Erreur serveur';

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">
          Balance personnalisée
        </CardTitle>
        <CardDescription className="text-ink-soft">
          Uploadez une balance CSV ou Excel (Sage Saari, CIEL, export tableur…) pour générer, sans
          passer par les écritures validées, l&apos;ensemble des états dérivables des soldes : Bilan,
          Compte de résultat, Balance générale, SIG, Ratios (fiche de synthèse) et Annexe partielle.
          Utile pour des simulations ou des reprises d&apos;antériorité. En chargeant en plus une
          balance de l&apos;exercice antérieur (N-1), vous débloquez les états Comparative,
          Pluriannuelle et TFT (flux de trésorerie). La balance âgée et le grand livre exigent le
          détail des écritures et ne sont pas disponibles ici.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* ── Zone de dépôt ── */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) void handleFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'relative cursor-pointer rounded-md border-2 border-dashed p-8 text-center transition-colors duration-fast',
            dragging
              ? 'border-accent bg-accent-soft/30'
              : 'border-line-strong bg-sunk/30 hover:border-accent/60 hover:bg-sunk/50',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xls"
            className="sr-only"
            aria-label="Fichier de balance"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
          <Upload className="mx-auto mb-3 h-9 w-9 text-ink-mute" strokeWidth={1.5} />
          <p className="font-medium text-ink">Glisser-déposer une balance CSV ou Excel</p>
          <p className="mt-1 text-sm text-ink-soft">
            ou cliquer pour choisir un fichier (.csv, .txt, .tsv, .xlsx)
          </p>
          <p className="mt-3 inline-block rounded-xs bg-sunk px-3 py-1 font-mono text-2xs text-ink-mute">
            Compte · Libellé · Solde Débiteur · Solde Créditeur
          </p>
        </div>

        {parseError !== null && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-md border border-critical/40 bg-critical-soft/60 px-4 py-3 text-sm text-critical-ink"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <div>
              <p className="font-medium">Erreur de parsing</p>
              <p className="mt-0.5 text-xs opacity-80">{parseError}</p>
            </div>
          </div>
        )}

        {parsed !== null && (
          <>
            {/* ── Récapitulatif ── */}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
              <div className="bg-paper px-4 py-2.5">
                <p className="text-2xs uppercase tracking-wider text-ink-mute">Comptes</p>
                <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
                  {parsed.rows.length.toLocaleString('fr-FR')}
                </p>
              </div>
              <div className="bg-paper px-4 py-2.5">
                <p className="text-2xs uppercase tracking-wider text-ink-mute">∑ Débiteur</p>
                <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
                  {fmt(parsed.totalDebit.toFixed(2))}
                </p>
              </div>
              <div className="bg-paper px-4 py-2.5">
                <p className="text-2xs uppercase tracking-wider text-ink-mute">∑ Créditeur</p>
                <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
                  {fmt(parsed.totalCredit.toFixed(2))}
                </p>
              </div>
              <div className={cn('px-4 py-2.5', isBalanced ? 'bg-accent-soft/60' : 'bg-warn-soft/60')}>
                <p
                  className={cn(
                    'text-2xs uppercase tracking-wider',
                    isBalanced ? 'text-accent-ink' : 'text-warn-ink',
                  )}
                >
                  Équilibre
                </p>
                <p
                  className={cn(
                    'mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium',
                    isBalanced ? 'text-accent-ink' : 'text-warn-ink',
                  )}
                >
                  {isBalanced ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Équilibrée
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4" />
                      Déséquilibre {fmt(Math.abs(parsed.totalDebit - parsed.totalCredit).toFixed(2))}
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* ── Colonnes détectées ── */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-mute">
              <span className="shrink-0">Colonnes détectées :</span>
              {Object.entries(parsed.columnHints).map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex items-center gap-1 rounded-xs border border-line bg-sunk px-2 py-0.5 font-mono text-[11px]"
                >
                  <span className="text-ink-mute">{k}</span>
                  <span className="text-line-strong" aria-hidden>
                    →
                  </span>
                  <span className="text-ink-soft">{v}</span>
                </span>
              ))}
            </div>

            {/* ── Aperçu ── */}
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Compte</th>
                    <th className="px-3 py-2 text-left font-medium">Libellé</th>
                    <th className="px-3 py-2 text-right font-medium">Solde Débiteur</th>
                    <th className="px-3 py-2 text-right font-medium">Solde Créditeur</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllRows ? parsed.rows : parsed.rows.slice(0, 12)).map((r, i) => (
                    <tr key={i} className="border-t border-line hover:bg-sunk/30">
                      <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">{r.code}</td>
                      <td className="max-w-[24ch] truncate px-3 py-1.5 text-xs text-ink">
                        {r.label || <span className="italic text-ink-mute">—</span>}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-1.5 text-right font-mono tabular-nums text-xs',
                          Number(r.debit) === 0 ? 'text-ink-mute' : 'text-ink',
                        )}
                      >
                        {Number(r.debit) === 0 ? '—' : fmt(r.debit)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-1.5 text-right font-mono tabular-nums text-xs',
                          Number(r.credit) === 0 ? 'text-ink-mute' : 'text-ink',
                        )}
                      >
                        {Number(r.credit) === 0 ? '—' : fmt(r.credit)}
                      </td>
                    </tr>
                  ))}
                  {parsed.rows.length > 12 && (
                    <tr className="border-t border-line/50 bg-sunk/30">
                      <td colSpan={4} className="px-0 py-0 text-center">
                        <button
                          type="button"
                          onClick={() => setShowAllRows((v) => !v)}
                          className="press w-full px-3 py-2 text-center text-xs font-medium text-accent-ink transition-colors duration-fast hover:bg-accent-soft/50"
                          aria-expanded={showAllRows}
                        >
                          {showAllRows
                            ? `▲ Réduire — n’afficher que les 12 premières lignes`
                            : `▼ Afficher les ${(parsed.rows.length - 12).toLocaleString('fr-FR')} lignes restantes (total ${parsed.rows.length.toLocaleString('fr-FR')})`}
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Type de balance — information critique ── */}
            <BalanceTypeSelector value={balanceType} onChange={setBalanceType} />

            {/* ── Comparaison & TFT (balances antérieures, optionnel) ── */}
            <PreviousBalancesUpload
              parsedPrev={parsedPrev}
              prevAsAtDate={prevAsAtDate}
              onPrevFile={(f) => void handlePrevFile(f)}
              onPrevAsAtDateChange={setPrevAsAtDate}
              parsedPrev2={parsedPrev2}
              prev2AsAtDate={prev2AsAtDate}
              onPrev2File={(f) => void handlePrev2File(f)}
              onPrev2AsAtDateChange={setPrev2AsAtDate}
              error={prevParseError}
            />

            {/* ── Paramètres ── */}
            <form
              className="grid gap-5 lg:grid-cols-[auto_auto_auto_1fr_auto] lg:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                mutation.mutate();
              }}
            >
              <FilterGroup title="Date de clôture" subtitle="Arrêté de la balance">
                <Input
                  type="date"
                  value={asAtDate}
                  onChange={(e) => setAsAtDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </FilterGroup>

              <FilterGroup title="Résultat net" subtitle="Incorporation au passif">
                <label className="flex h-9 cursor-pointer items-center gap-2 self-end whitespace-nowrap rounded-sm border border-line-strong bg-paper px-3 text-sm text-ink-soft transition-colors hover:bg-sunk has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink">
                  <input
                    type="checkbox"
                    checked={incorporateResult}
                    onChange={(e) => setIncorporateResult(e.target.checked)}
                    className="h-3.5 w-3.5 accent-accent"
                  />
                  Incorporer résultat
                </label>
              </FilterGroup>

              {incorporateResult && (
                <FilterGroup title="Début exercice" subtitle="Pour calcul résultat net">
                  <Input
                    type="date"
                    value={fyStart}
                    onChange={(e) => setFyStart(e.target.value)}
                    className="h-9 w-40 font-mono tabular-nums"
                  />
                </FilterGroup>
              )}

              <div />

              <div className="flex flex-col items-stretch gap-1 lg:items-end">
                <span className="select-none text-2xs uppercase tracking-wider text-transparent">
                  .
                </span>
                <Button type="submit" disabled={mutation.isPending} className="h-9">
                  {mutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Scale className="mr-2 h-4 w-4" strokeWidth={1.5} />
                  )}
                  Générer les états
                </Button>
              </div>
            </form>
          </>
        )}

        {mutation.isError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-md border border-critical/40 bg-critical-soft/60 px-4 py-3 text-sm text-critical-ink"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <p>{mutationErrorMessage}</p>
          </div>
        )}

        {/* ── Résultats ── */}
        {mutation.data !== undefined && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <div className="flex gap-1">
                {RESULT_TABS.filter((t) => {
                  if (t.key === 'annexe') return mutation.data.annexe !== null;
                  if (t.key === 'comparative') return mutation.data.comparative !== null;
                  if (t.key === 'multiyear') return mutation.data.multiYear !== null;
                  if (t.key === 'tft') return mutation.data.tft !== null;
                  return true;
                }).map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-sm font-medium transition-colors duration-fast',
                      activeTab === key
                        ? 'border-accent bg-accent-soft text-accent-ink'
                        : 'border-line-strong bg-paper text-ink-soft hover:bg-sunk hover:text-ink',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-xs border border-warn/30 bg-warn-soft px-2.5 py-1 text-xs text-warn-ink">
                  <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  Simulation
                </span>
                {balanceType === 'avant-inventaire' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-xs border border-[oklch(0.75_0.12_55)] bg-[oklch(0.97_0.03_55)] px-2.5 py-1 text-xs text-[oklch(0.40_0.12_55)]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    Avant inventaire — provisoire
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-xs border border-[oklch(0.80_0.10_145)] bg-[oklch(0.95_0.04_145)] px-2.5 py-1 text-xs text-[oklch(0.35_0.14_145)]">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                    Après inventaire
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={exportBalanceCsv}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                  CSV
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={exportBalanceXls}
                  className="h-7 gap-1.5 text-xs"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.5} />
                  XLS
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.print()}
                  className="h-7 gap-1.5 text-xs"
                >
                  <Printer className="h-3.5 w-3.5" strokeWidth={1.5} />
                  PDF
                </Button>
              </div>
            </div>
            {mutation.data.unusualBalances.length > 0 && (
              <div className="rounded-sm border border-warn/40 bg-warn-soft/40 p-4">
                <div className="mb-1.5 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warn-ink" strokeWidth={1.5} />
                  <p className="text-sm font-medium text-ink">
                    Contrôle qualité —{' '}
                    <span className="font-mono tabular-nums">
                      {mutation.data.unusualBalances.length}
                    </span>{' '}
                    solde{mutation.data.unusualBalances.length > 1 ? 's' : ''} inhabituel
                    {mutation.data.unusualBalances.length > 1 ? 's' : ''}
                  </p>
                </div>
                <p className="mb-3 max-w-[80ch] text-xs text-ink-mute">
                  Comptes au signe inhabituel ou sensibles aux erreurs d&apos;imputation. Souvent
                  légitimes (avances, comptes courants), mais vérifiez qu&apos;il ne s&apos;agit pas
                  d&apos;un <strong>mauvais compte choisi</strong> dans le logiciel source — cela
                  fausserait le Bilan et le Compte de résultat.
                </p>
                <ul className="space-y-2">
                  {mutation.data.unusualBalances.map((u) => (
                    <li
                      key={u.code}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                    >
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center rounded-xs px-1.5 py-0.5 font-medium',
                          u.severity === 'warning'
                            ? 'bg-warn-soft text-warn-ink'
                            : 'bg-info-soft text-info-ink',
                        )}
                      >
                        {u.severity === 'warning' ? 'À vérifier' : 'Info'}
                      </span>
                      <span className="font-mono text-ink">{u.code}</span>
                      <span className="text-ink-soft">{u.label}</span>
                      <span className="font-mono tabular-nums text-ink">
                        {fmt(u.amount)} ({u.sign === 'D' ? 'débiteur' : 'créditeur'})
                      </span>
                      <span className="basis-full text-ink-mute">{u.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {activeTab === 'bilan' ? (
              <div className="space-y-4">
                <BalanceSheetResult report={mutation.data.bilan} />
                <StockBreakdownNote breakdown={mutation.data.stockBreakdown} />
              </div>
            ) : activeTab === 'cr' ? (
              <ProfitLossResult report={mutation.data.cr} />
            ) : activeTab === 'sig' ? (
              <SigResult report={mutation.data.sig} />
            ) : activeTab === 'ratios' ? (
              <RatiosResult report={mutation.data.ratios} />
            ) : activeTab === 'balance' ? (
              <TrialBalanceResult report={mutation.data.trialBalance} />
            ) : activeTab === 'annexe' && mutation.data.annexe !== null ? (
              <AnnexeResult report={mutation.data.annexe} />
            ) : activeTab === 'comparative' && mutation.data.comparative !== null ? (
              <ComparativeResult report={mutation.data.comparative} />
            ) : activeTab === 'multiyear' && mutation.data.multiYear !== null ? (
              <MultiYearResult report={mutation.data.multiYear} />
            ) : activeTab === 'tft' && mutation.data.tft !== null ? (
              <TftResult report={mutation.data.tft} />
            ) : null}
          </div>
        )}

        {parsed === null && parseError === null && (
          <div className="rounded-md border border-line bg-sunk/40 px-4 py-6 text-center">
            <p className="text-sm text-ink-soft">
              Uploader une balance CSV pour commencer la simulation.
            </p>
            <p className="mt-1 text-xs text-ink-mute">
              Le fichier est analysé côté client — aucune donnée n&apos;est envoyée avant de cliquer
              sur <span className="font-medium text-ink">Générer les états</span>.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
