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
  PieChart,
  Scale,
  Stethoscope,
  TrendingUp,
  Wallet,
  X,
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
import { cn } from '@/lib/utils';
import { useCurrentOrg } from '@/stores/auth-store';
import type { AccountView } from '@/types/accounting-plan';

import { ReportNav, getReportHint, getReportLabel, type ReportMode } from './_components/report-nav';
import type {
  AgingBalanceReport,
  AnalyticAxisSummary,
  AnnexeNoteDetailReport,
  AnnexeReport,
  BalanceSheetReport,
  BilanMasse,
  CashFlowReport,
  CashFlowSection,
  CashTrendReport,
  ComparativeBalanceReport,
  FinancialRatio,
  FinancialRatiosReport,
  GeneralLedgerReport,
  SoldeIntermediaire,
  ImportAnomalyGroup,
  ImportDiagnosticReport,
  ImportSessionSummary,
  MarginByAxisReport,
  MultiYearBalanceReport,
  ProfitLossLine,
  ProfitLossReport,
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
interface MultiYearBalanceEnvelope {
  readonly report: MultiYearBalanceReport;
}
interface AgingBalanceEnvelope {
  readonly report: AgingBalanceReport;
}
interface TftEnvelope {
  readonly report: CashFlowReport;
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
interface BalanceSheetEnvelope {
  readonly report: BalanceSheetReport;
}
interface ProfitLossEnvelope {
  readonly report: ProfitLossReport;
}

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

  const activeLabel = getReportLabel(mode);
  const activeHint = getReportHint(mode);

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-wider text-ink-mute">
              États · Reporting OHADA
            </p>
            <h1 className="mt-1 font-display text-3xl font-medium tracking-tight text-ink">
              États financiers
            </h1>
            <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-soft">
              Treize lectures du même grand livre. Les balances pour la matière première, les
              états SYSCOHADA pour le réglementaire, les analyses pour la lecture managériale.
              Toutes les valeurs s&apos;agrègent à partir des écritures committées sur la période
              choisie.
            </p>
          </div>
          <div className="shrink-0">
            <AnnualPackageButton orgId={orgId} />
          </div>
        </header>

        <ReportNav active={mode} onChange={setMode} />

        {/* Légende du rapport actif — donne un repère explicite avant que
            les filtres + tableau ne se déploient en dessous. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Vous consultez</p>
          <p className="font-display text-xl font-medium tracking-tight text-ink">
            {activeLabel}
          </p>
          {activeHint && (
            <p className="text-sm text-ink-soft">
              <span className="text-line-strong" aria-hidden>
                ·
              </span>{' '}
              {activeHint}
            </p>
          )}
        </div>

        {mode === 'balance-sheet' ? (
          <BalanceSheetPanel orgId={orgId} />
        ) : mode === 'profit-loss' ? (
          <ProfitLossPanel orgId={orgId} />
        ) : mode === 'trial-balance' ? (
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
      await api.download(
        `/organizations/${orgId}/reports/annual-package.zip?${params.toString()}`,
        'annual-package.zip',
      );
      setOpen(false);
    } finally {
      setDownloading(false);
    }
  };

  if (!open) {
    return (
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-accent/30 bg-accent-soft text-accent-ink hover:bg-accent-soft/80"
      >
        <Package className="mr-2 h-4 w-4" strokeWidth={1.5} />
        Dossier annuel · ZIP
      </Button>
    );
  }
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-line bg-paper p-3 shadow-pop">
      <div className="space-y-1">
        <Label
          htmlFor="pkg-from"
          className="text-2xs uppercase tracking-wider text-ink-soft"
        >
          Du
        </Label>
        <Input
          id="pkg-from"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="h-9 w-40 font-mono tabular-nums"
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor="pkg-to"
          className="text-2xs uppercase tracking-wider text-ink-soft"
        >
          Au
        </Label>
        <Input
          id="pkg-to"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="h-9 w-40 font-mono tabular-nums"
        />
      </div>
      <Button type="button" onClick={triggerDownload} disabled={downloading}>
        {downloading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Package className="mr-2 h-4 w-4" strokeWidth={1.5} />
        )}
        Générer le ZIP
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
        <X className="mr-1.5 h-3.5 w-3.5" />
        Annuler
      </Button>
    </div>
  );
}

// ─── Bilan OHADA (SYSCOHADA AUDCIF) ────────────────────────────────────

/**
 * Bilan = photographie à une date donnée du patrimoine (actif) et de
 * son financement (passif). Le backend renvoie la hiérarchie W2.1
 * conforme DSF : 35 postes lettrés AD-BZ (actif) et CA-DZ (passif)
 * groupés en rubriques puis en masses.
 *
 * Le résultat net de l'exercice est automatiquement incorporé aux
 * capitaux propres quand `fiscalYearStartDate` est fourni — sans
 * cela, le bilan reste déséquilibré (différence = résultat net).
 */
function BalanceSheetPanel({ orgId }: { readonly orgId: string }) {
  const [asAtDate, setAsAtDate] = useState<string>(todayIso());
  const [fiscalYearStartDate, setFiscalYearStartDate] = useState<string>(yearStartIso());
  const [compareAsAtDate, setCompareAsAtDate] = useState<string>(previousYearEndIso());
  const [compareFiscalYearStartDate, setCompareFiscalYearStartDate] = useState<string>(
    previousYearStartIso(),
  );
  const [compareEnabled, setCompareEnabled] = useState<boolean>(true);
  const [submitted, setSubmitted] = useState<{
    asAtDate: string;
    fiscalYearStartDate: string;
    compareAsAtDate?: string;
    compareFiscalYearStartDate?: string;
  } | null>(null);

  const buildParams = (s: NonNullable<typeof submitted>): URLSearchParams => {
    const p = new URLSearchParams({
      asAtDate: s.asAtDate,
      fiscalYearStartDate: s.fiscalYearStartDate,
    });
    if (s.compareAsAtDate !== undefined) {
      p.set('compareAsAtDate', s.compareAsAtDate);
    }
    if (s.compareFiscalYearStartDate !== undefined) {
      p.set('compareFiscalYearStartDate', s.compareFiscalYearStartDate);
    }
    return p;
  };

  const query = useQuery<BalanceSheetReport, ApiError>({
    queryKey: ['reports', 'balance-sheet', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<BalanceSheetEnvelope>(
        `/organizations/${orgId}/reports/balance-sheet?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  const downloadXlsx = (): void => {
    if (submitted === null) return;
    void api.download(
      `/organizations/${orgId}/reports/balance-sheet.xlsx?${buildParams(submitted).toString()}`,
      'bilan.xlsx',
    );
  };

  const downloadPdf = (): void => {
    if (submitted === null) return;
    void api.download(
      `/organizations/${orgId}/reports/balance-sheet.pdf?${buildParams(submitted).toString()}`,
      'bilan.pdf',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">
          Bilan
        </CardTitle>
        <CardDescription className="text-ink-soft">
          Patrimoine et financement à une date donnée, conforme SYSCOHADA AUDCIF (hiérarchie
          DSF : 35 postes lettrés). Le résultat net de l&apos;exercice est incorporé aux
          capitaux propres pour assurer l&apos;équilibre Actif = Passif.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <form
          className="grid gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({
              asAtDate,
              fiscalYearStartDate,
              ...(compareEnabled
                ? {
                    compareAsAtDate,
                    compareFiscalYearStartDate,
                  }
                : {}),
            });
          }}
        >
          <FilterGroup title="Arrêté" subtitle="Date de photographie et exercice">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="bs-fy" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Début exercice
                </Label>
                <Input
                  id="bs-fy"
                  type="date"
                  value={fiscalYearStartDate}
                  onChange={(e) => setFiscalYearStartDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bs-at" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Arrêté au
                </Label>
                <Input
                  id="bs-at"
                  type="date"
                  value={asAtDate}
                  onChange={(e) => setAsAtDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
            </div>
          </FilterGroup>

          <FilterGroup title="Comparaison N-1" subtitle="Exercice précédent">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex h-9 cursor-pointer items-center gap-2 self-end whitespace-nowrap rounded-sm border border-line-strong bg-paper px-3 text-sm text-ink-soft transition-colors hover:bg-sunk has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink">
                <input
                  type="checkbox"
                  checked={compareEnabled}
                  onChange={(e) => setCompareEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Activer
              </label>
              <div className="space-y-1">
                <Label
                  htmlFor="bs-cmp-fy"
                  className="text-2xs uppercase tracking-wider text-ink-soft"
                >
                  Début N-1
                </Label>
                <Input
                  id="bs-cmp-fy"
                  type="date"
                  value={compareFiscalYearStartDate}
                  onChange={(e) => setCompareFiscalYearStartDate(e.target.value)}
                  disabled={!compareEnabled}
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="bs-cmp-at"
                  className="text-2xs uppercase tracking-wider text-ink-soft"
                >
                  Arrêté N-1
                </Label>
                <Input
                  id="bs-cmp-at"
                  type="date"
                  value={compareAsAtDate}
                  onChange={(e) => setCompareAsAtDate(e.target.value)}
                  disabled={!compareEnabled}
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
            </div>
          </FilterGroup>

          <div className="flex flex-col items-stretch gap-1 lg:items-end">
            <span className="select-none text-2xs uppercase tracking-wider text-transparent">
              .
            </span>
            <div className="flex flex-wrap items-end gap-2">
              <Button type="submit" disabled={query.isFetching} className="h-9">
                {query.isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Scale className="mr-2 h-4 w-4" strokeWidth={1.5} />
                )}
                Générer le bilan
              </Button>
              {query.data !== undefined && (
                <>
                  <Button type="button" variant="outline" onClick={downloadXlsx}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    XLSX
                  </Button>
                  <Button type="button" variant="outline" onClick={downloadPdf}>
                    <FileText className="mr-2 h-4 w-4" />
                    PDF
                  </Button>
                </>
              )}
            </div>
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? (
          <BalanceSheetView report={query.data} />
        ) : submitted === null ? (
          <div className="rounded-md border border-line bg-sunk/40 px-4 py-6 text-center">
            <p className="text-sm text-ink-soft">
              Choisir la date d&apos;arrêté puis cliquer sur{' '}
              <span className="font-medium text-ink">Générer le bilan</span>.
            </p>
            <p className="mt-1 text-xs text-ink-mute">
              Par défaut, arrêté au jour J avec exercice ouvert au 1<sup>er</sup> janvier,
              comparé à l&apos;exercice précédent.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BalanceSheetView({ report }: { readonly report: BalanceSheetReport }) {
  const differenceNum = Number(report.totals.difference);
  // Seuil de 1 FCFA pour la tolérance d'arrondi (5 décimales backend).
  // En dessous on considère que l'équilibre est respecté.
  const isBalanced = Math.abs(differenceNum) < 1;
  const hasComp = report.previous !== undefined;

  return (
    <div className="space-y-6">
      {/* Bandeau récap : la signature du bilan en 4 chiffres. L'équilibre
          Actif=Passif est LE contrôle visuel d'un bilan OHADA — un écart
          ≠ 0 signifie un problème (résultat non incorporé, comptes hors
          plan, écriture déséquilibrée). */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Arrêté au</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.asAtDate)}
          </p>
          {hasComp && report.previous && (
            <p className="mt-0.5 font-mono text-2xs tabular-nums text-ink-mute">
              vs {formatShortDate(report.previous.asAtDate)}
            </p>
          )}
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Total Actif</p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
            {fmt(report.totals.actif)}
          </p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Total Passif</p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
            {fmt(report.totals.passif)}
          </p>
        </div>
        <div
          className={cn('px-4 py-3', isBalanced ? 'bg-accent-soft/60' : 'bg-critical-soft')}
        >
          <p
            className={cn(
              'text-2xs uppercase tracking-wider',
              isBalanced ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            Équilibre Actif − Passif
          </p>
          <p
            className={cn(
              'mt-0.5 inline-flex items-center gap-1.5 font-mono text-xl font-medium tabular-nums',
              isBalanced ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            {isBalanced ? (
              <>
                <CheckCircle2 className="h-5 w-5" />
                0,00
              </>
            ) : (
              <>
                <AlertTriangle className="h-5 w-5" />
                {fmt(report.totals.difference)}
              </>
            )}
          </p>
          {report.netResultIncorporated !== null && (
            <p className="mt-0.5 text-2xs text-accent-ink/80">
              Résultat net incorporé : {fmt(report.netResultIncorporated)}
            </p>
          )}
        </div>
      </div>

      {/* Layout classique du Bilan : Actif à gauche, Passif à droite,
          en miroir comme une liasse fiscale imprimée. Sur mobile, stack
          vertical (lg:grid-cols-2). */}
      <div className="grid gap-6 lg:grid-cols-2">
        <BilanColumn title="Actif" subtitle="Patrimoine — emplois durables et circulants" masses={report.actifMasses} hasComp={hasComp} tone="info" />
        <BilanColumn title="Passif" subtitle="Financement — capitaux propres et dettes" masses={report.passifMasses} hasComp={hasComp} tone="accent" />
      </div>

      {report.unclassified.length > 0 && (
        <section className="rounded-md border border-warn/30 bg-warn-soft/60 p-4">
          <header className="flex items-baseline gap-2 border-b border-warn/30 pb-2">
            <AlertTriangle className="h-4 w-4 self-center text-warn" strokeWidth={1.5} />
            <h4 className="font-display text-base font-medium tracking-tight text-warn-ink">
              Comptes hors référentiel
            </h4>
            <span className="font-mono text-xs tabular-nums text-warn-ink/80">
              {report.unclassified.length}
            </span>
          </header>
          <p className="mt-2 text-xs text-warn-ink/90">
            Ces comptes du plan comptable n&apos;ont matché aucun poste lettré SYSCOHADA. Ils
            ne figurent pas dans le bilan officiel — vérifier que leurs codes sont conformes
            au PCG OHADA.
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {report.unclassified.slice(0, 10).map((p) => (
              <li key={p.code} className="flex justify-between gap-2">
                <span className="font-mono text-warn-ink">
                  {p.code} · {p.label}
                </span>
                <span className="font-mono tabular-nums text-warn-ink">{fmt(p.net)}</span>
              </li>
            ))}
            {report.unclassified.length > 10 && (
              <li className="text-warn-ink/70">
                … et {report.unclassified.length - 10} autres
              </li>
            )}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Colonne d'un côté du bilan (Actif ou Passif). Empile les masses
 * (sous-totaux lettrés AZ, CP, DZ…) en cartes, chaque masse expose
 * ses rubriques et leurs postes lettrés détaillés.
 */
function BilanColumn({
  title,
  subtitle,
  masses,
  hasComp,
  tone,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly masses: ReadonlyArray<BilanMasse>;
  readonly hasComp: boolean;
  readonly tone: 'info' | 'accent';
}) {
  const toneClasses = {
    info: { dot: 'bg-info', headerText: 'text-info-ink' },
    accent: { dot: 'bg-accent', headerText: 'text-accent-ink' },
  };
  const t = toneClasses[tone];
  return (
    <section>
      <header className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
        <span aria-hidden className={cn('h-2 w-2 self-center rounded-full', t.dot)} />
        <h3 className={cn('font-display text-xl font-medium tracking-tight', t.headerText)}>
          {title}
        </h3>
        <p className="ml-2 text-xs text-ink-soft">{subtitle}</p>
      </header>
      <div className="space-y-4">
        {masses.map((m) => (
          <BilanMasseBlock key={m.code} masse={m} hasComp={hasComp} />
        ))}
      </div>
    </section>
  );
}

function BilanMasseBlock({
  masse,
  hasComp,
}: {
  readonly masse: BilanMasse;
  readonly hasComp: boolean;
}) {
  const variationPct =
    hasComp && masse.totalPrevious !== undefined && Number(masse.totalPrevious) !== 0
      ? (((Number(masse.total) - Number(masse.totalPrevious)) / Math.abs(Number(masse.totalPrevious))) * 100).toFixed(1)
      : null;
  return (
    <article className="overflow-hidden rounded-md border border-line">
      {/* Header de masse : code + label + total. C'est le sous-total
          lettré (AZ, CP, DZ...) qui apparaît dans la DSF. */}
      <header className="flex items-baseline gap-3 border-b border-line bg-sunk/60 px-4 py-2.5">
        <span className="font-mono text-xs font-semibold tabular-nums text-ink">
          {masse.code}
        </span>
        <span className="flex-1 truncate text-sm font-medium text-ink">{masse.label}</span>
        <span className="font-mono text-base font-medium tabular-nums text-ink">
          {fmt(masse.total)}
        </span>
        {variationPct !== null && (
          <VariationMicroChip percent={variationPct} />
        )}
      </header>
      {masse.rubriques.map((r) => (
        <div key={r.label} className="border-t border-line">
          <div className="flex items-baseline gap-3 bg-paper px-4 py-1.5">
            <span className="flex-1 truncate text-xs font-medium uppercase tracking-wider text-ink-soft">
              {r.label}
            </span>
            <span className="font-mono text-xs font-medium tabular-nums text-ink-soft">
              {fmt(r.subtotal)}
            </span>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {r.postes.map((p) => {
                const net = Number(p.net);
                const isZero = !Number.isFinite(net) || net === 0;
                return (
                  <tr key={p.code} className="border-t border-line">
                    <td className="px-4 py-1 font-mono text-xs text-ink-mute">{p.code}</td>
                    <td className="px-2 py-1 text-xs text-ink-soft">{p.label}</td>
                    <td
                      className={cn(
                        'px-4 py-1 text-right font-mono tabular-nums',
                        isZero ? 'text-ink-mute' : 'text-ink',
                      )}
                    >
                      {isZero ? '—' : fmt(p.net)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </article>
  );
}

/**
 * Mini-chip de variation % utilisée dans les masses du Bilan. Plus
 * compact que <VariationChip /> qui a besoin de la variation absolue.
 * Ici on n'affiche que le %, le contexte (masse → masse N-1) rend la
 * lecture immédiate.
 */
function VariationMicroChip({ percent }: { readonly percent: string }) {
  const n = Number(percent);
  const isUp = Number.isFinite(n) && n > 0;
  const isDown = Number.isFinite(n) && n < 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xs border px-1.5 py-0.5 font-mono text-2xs tabular-nums',
        isUp
          ? 'border-accent/30 bg-accent-soft text-accent-ink'
          : isDown
            ? 'border-critical/30 bg-critical-soft text-critical-ink'
            : 'border-line-strong bg-sunk text-ink-mute',
      )}
    >
      <span aria-hidden>{isUp ? '▲' : isDown ? '▼' : '·'}</span>
      {percent}%
    </span>
  );
}

// ─── Compte de Résultat OHADA ──────────────────────────────────────────

/**
 * Compte de Résultat = présentation classique charges/produits sur
 * une période. Différent du SIG (qui décompose la cascade XA-XI) :
 * ici on a 2 colonnes côte à côte avec totaux et résultat net.
 */
function ProfitLossPanel({ orgId }: { readonly orgId: string }) {
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [submitted, setSubmitted] = useState<{ fromDate: string; toDate: string } | null>(null);

  const buildParams = (s: NonNullable<typeof submitted>): URLSearchParams =>
    new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate });

  const query = useQuery<ProfitLossReport, ApiError>({
    queryKey: ['reports', 'profit-loss', orgId, submitted],
    queryFn: async () => {
      if (submitted === null) throw new Error('not submitted');
      const data = await api.get<ProfitLossEnvelope>(
        `/organizations/${orgId}/reports/profit-loss?${buildParams(submitted).toString()}`,
      );
      return data.report;
    },
    enabled: orgId !== '' && submitted !== null,
  });

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">
          Compte de résultat
        </CardTitle>
        <CardDescription className="text-ink-soft">
          Charges et produits de l&apos;exercice, présentation classique de la liasse fiscale.
          Le résultat net (produits − charges) est repris dans le bilan via le solde des
          capitaux propres.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <form
          className="grid gap-5 lg:grid-cols-[auto_auto_1fr] lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({ fromDate, toDate });
          }}
        >
          <FilterGroup title="Période" subtitle="Exercice à analyser">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="pl-from" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Du
                </Label>
                <Input
                  id="pl-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pl-to" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Au
                </Label>
                <Input
                  id="pl-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
            </div>
          </FilterGroup>

          <div className="flex flex-col items-stretch gap-1 lg:items-end">
            <span className="select-none text-2xs uppercase tracking-wider text-transparent">
              .
            </span>
            <Button type="submit" disabled={query.isFetching} className="h-9">
              {query.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PieChart className="mr-2 h-4 w-4" strokeWidth={1.5} />
              )}
              Générer le compte de résultat
            </Button>
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? <ProfitLossView report={query.data} /> : null}
      </CardContent>
    </Card>
  );
}

function ProfitLossView({ report }: { readonly report: ProfitLossReport }) {
  const resultatNum = Number(report.resultat);
  const isBenefice = Number.isFinite(resultatNum) && resultatNum > 0;
  const isPerte = Number.isFinite(resultatNum) && resultatNum < 0;

  return (
    <div className="space-y-6">
      {/* Bandeau récap : période + ∑ produits + ∑ charges + résultat
          net (signed, bascule accent-soft / critical-soft selon
          bénéfice/perte). */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Période</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.fromDate)} → {formatShortDate(report.toDate)}
          </p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-accent-ink">∑ Produits</p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-accent-ink">
            {fmt(report.totalProduits)}
          </p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-critical-ink">∑ Charges</p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-critical-ink">
            {fmt(report.totalCharges)}
          </p>
        </div>
        <div
          className={cn(
            'px-4 py-3',
            isBenefice
              ? 'bg-accent-soft/60'
              : isPerte
                ? 'bg-critical-soft'
                : 'bg-sunk/60',
          )}
        >
          <p
            className={cn(
              'text-2xs uppercase tracking-wider',
              isBenefice
                ? 'text-accent-ink'
                : isPerte
                  ? 'text-critical-ink'
                  : 'text-ink-mute',
            )}
          >
            {isBenefice ? '▲ Bénéfice' : isPerte ? '▼ Perte' : '· Résultat'}
          </p>
          <p
            className={cn(
              'mt-0.5 font-mono text-xl font-medium tabular-nums',
              isBenefice
                ? 'text-accent-ink'
                : isPerte
                  ? 'text-critical-ink'
                  : 'text-ink-soft',
            )}
          >
            {fmt(report.resultat)}
          </p>
        </div>
      </div>

      {/* Layout classique : Charges à gauche, Produits à droite. En
          comptabilité OHADA c'est l'inverse de la convention française
          (produits à droite), mais on garde la disposition canonique :
          charges = ce qui sort, produits = ce qui entre. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ProfitLossColumn title="Charges" subtitle="Consommations et coûts de l'exercice" lines={report.charges} total={report.totalCharges} tone="critical" />
        <ProfitLossColumn title="Produits" subtitle="Ventes, prestations et autres recettes" lines={report.produits} total={report.totalProduits} tone="accent" />
      </div>
    </div>
  );
}

function ProfitLossColumn({
  title,
  subtitle,
  lines,
  total,
  tone,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly lines: ReadonlyArray<ProfitLossLine>;
  readonly total: string;
  readonly tone: 'critical' | 'accent';
}) {
  const toneClasses = {
    critical: {
      dot: 'bg-critical',
      headerText: 'text-critical-ink',
      totalRow: 'border-l-2 border-critical/40 bg-critical-soft/40 text-critical-ink',
    },
    accent: {
      dot: 'bg-accent',
      headerText: 'text-accent-ink',
      totalRow: 'border-l-2 border-accent/40 bg-accent-soft/40 text-accent-ink',
    },
  };
  const t = toneClasses[tone];
  return (
    <section>
      <header className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
        <span aria-hidden className={cn('h-2 w-2 self-center rounded-full', t.dot)} />
        <h4 className={cn('font-display text-base font-medium tracking-tight', t.headerText)}>
          {title}
        </h4>
        <p className="ml-2 text-xs text-ink-soft">{subtitle}</p>
      </header>
      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Réf.</th>
              <th className="px-3 py-2 text-left font-medium">Libellé</th>
              <th className="px-3 py-2 text-right font-medium">Montant</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const num = Number(line.amount);
              const isZero = !Number.isFinite(num) || num === 0;
              return (
                <tr key={line.code} className="border-t border-line">
                  <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">{line.code}</td>
                  <td className="px-3 py-1.5 text-xs text-ink">{line.label}</td>
                  <td
                    className={cn(
                      'px-3 py-1.5 text-right font-mono tabular-nums',
                      isZero ? 'text-ink-mute' : 'text-ink',
                    )}
                  >
                    {isZero ? '—' : fmt(line.amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={cn('border-t-2 font-medium', t.totalRow)}>
              <td className="px-3 py-2.5"></td>
              <td className="px-3 py-2.5 text-right text-2xs uppercase tracking-wider">
                Total {title.toLowerCase()}
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-base tabular-nums">
                {fmt(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
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
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Marge par activité</CardTitle>
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
          <div className="rounded-md border border-warn/30 bg-warn-soft p-3 text-sm text-warn-ink">
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
      <p className="text-sm text-ink-mute">
        Aucune écriture imputée sur l&apos;axe <strong>{report.axisType}</strong> pour cette
        période.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-sunk text-left text-2xs uppercase tracking-wider text-ink-mute">
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
              <tr key={row.axisCode} className="border-t border-line hover:bg-sunk/40">
                <td className="px-2 py-1 font-mono text-xs font-semibold">{row.axisCode}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.chiffreAffaires)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.achatsConsommes)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.margeBrute)}</td>
                <td className="px-2 py-1 text-right font-mono text-xs text-ink-mute">
                  {row.margeBrutePercent !== null ? `${row.margeBrutePercent}%` : '—'}
                </td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.chargesPersonnel)}</td>
                <td className="px-2 py-1 text-right font-mono">{fmt(row.autresCharges)}</td>
                <td
                  className={`px-2 py-1 text-right font-mono font-semibold ${rn < 0 ? 'text-critical' : 'text-accent-ink'}`}
                >
                  {fmt(row.resultatNet)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-accent/30 bg-accent-soft/40 font-medium text-accent-ink">
            <td className="px-2 py-2">TOTAL</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.chiffreAffaires)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.achatsConsommes)}</td>
            <td className="px-2 py-2 text-right font-mono">{fmt(report.totals.margeBrute)}</td>
            <td className="px-2 py-2 text-right font-mono text-xs text-ink-mute">
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
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">
          Balance générale
        </CardTitle>
        <CardDescription className="text-ink-soft">
          Solde de chaque compte sur la période choisie : ouverture, mouvements, clôture. Seules
          les écritures committées au journal sont projetées — les imports en staging restent
          invisibles tant qu&apos;ils n&apos;ont pas été validés.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <form
          className="grid gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-end"
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
          <FilterGroup title="Période" subtitle="Bornes de l'arrêté">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="tb-from" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Du
                </Label>
                <Input
                  id="tb-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tb-to" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Au
                </Label>
                <Input
                  id="tb-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
            </div>
          </FilterGroup>

          <FilterGroup title="Périmètre" subtitle="Filtres sur le plan comptable">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label
                  htmlFor="tb-class"
                  className="text-2xs uppercase tracking-wider text-ink-soft"
                >
                  Classe
                </Label>
                <select
                  id="tb-class"
                  value={accountClass}
                  onChange={(e) => setAccountClass(e.target.value)}
                  className="h-9 w-32 rounded-sm border border-line-strong bg-paper px-3 py-1 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
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
                <Label
                  htmlFor="tb-code-from"
                  className="text-2xs uppercase tracking-wider text-ink-soft"
                >
                  Code de
                </Label>
                <Input
                  id="tb-code-from"
                  placeholder="411"
                  value={codeFrom}
                  onChange={(e) => setCodeFrom(e.target.value)}
                  className="h-9 w-24 font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label
                  htmlFor="tb-code-to"
                  className="text-2xs uppercase tracking-wider text-ink-soft"
                >
                  Code à
                </Label>
                <Input
                  id="tb-code-to"
                  placeholder="419"
                  value={codeTo}
                  onChange={(e) => setCodeTo(e.target.value)}
                  className="h-9 w-24 font-mono tabular-nums"
                />
              </div>
              <label className="flex h-9 cursor-pointer items-center gap-2 self-end whitespace-nowrap rounded-sm border border-line-strong bg-paper px-3 text-sm text-ink-soft transition-colors hover:bg-sunk has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink">
                <input
                  type="checkbox"
                  checked={hideEmpty}
                  onChange={(e) => setHideEmpty(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Masquer comptes inactifs
              </label>
            </div>
          </FilterGroup>

          <div className="flex flex-col items-stretch gap-1 lg:items-end">
            <span className="text-2xs uppercase tracking-wider text-transparent select-none">
              .
            </span>
            <Button type="submit" disabled={query.isFetching} className="h-9">
              {query.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BarChart3 className="mr-2 h-4 w-4" strokeWidth={1.5} />
              )}
              Générer la balance
            </Button>
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? (
          <TrialBalanceTable report={query.data} submitted={submitted} />
        ) : submitted === null ? (
          <div className="rounded-md border border-line bg-sunk/40 px-4 py-6 text-center">
            <p className="text-sm text-ink-soft">
              Choisir une période puis cliquer sur{' '}
              <span className="font-medium text-ink">Générer la balance</span>.
            </p>
            <p className="mt-1 text-xs text-ink-mute">
              Par défaut, du 1<sup>er</sup> janvier de l&apos;année en cours à aujourd&apos;hui.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Wrapper de section de formulaire — kicker + subtitle + champs.
 * Utilisé pour grouper sémantiquement les filtres (Période, Périmètre…)
 * au lieu d'une grille uniforme qui mélange tout.
 */
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

interface TrialBalanceTableProps {
  readonly report: TrialBalanceReport;
  readonly submitted: {
    readonly fromDate: string;
    readonly toDate: string;
  } | null;
}

function TrialBalanceTable({ report, submitted }: TrialBalanceTableProps) {
  if (report.rows.length === 0) {
    return (
      <div className="rounded-md border border-line bg-sunk/40 px-4 py-6 text-center">
        <p className="text-sm text-ink-soft">Aucun mouvement sur la période avec ces filtres.</p>
        <p className="mt-1 text-xs text-ink-mute">
          Élargir les bornes de période, retirer le filtre de classe, ou décocher «&nbsp;Masquer
          comptes inactifs&nbsp;».
        </p>
      </div>
    );
  }

  // Vérification d'équilibre : la balance doit être équilibrée
  // (∑Débit = ∑Crédit) à chaque colonne. Un écart révèle un bug
  // d'agrégation côté backend OU une écriture déséquilibrée passée
  // par contournement de la double-saisie.
  const isBalanced =
    Number(report.totals.openingDebit) === Number(report.totals.openingCredit) &&
    Number(report.totals.periodDebit) === Number(report.totals.periodCredit) &&
    Number(report.totals.endingDebit) === Number(report.totals.endingCredit);

  return (
    <div className="space-y-3">
      {/* Bandeau récapitulatif : période exacte, nombre de comptes,
          équilibre. C'est ce qu'un comptable veut voir avant de scroller. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Période</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {submitted
              ? `${formatShortDate(submitted.fromDate)} → ${formatShortDate(submitted.toDate)}`
              : '—'}
          </p>
        </div>
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Comptes</p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
            {report.rows.length.toLocaleString('fr-FR')}
          </p>
        </div>
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Mouvements ∑ Débit</p>
          <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-ink">
            {fmt(report.totals.periodDebit)}
          </p>
        </div>
        <div
          className={cn(
            'px-4 py-2.5',
            isBalanced ? 'bg-accent-soft/60' : 'bg-critical-soft',
          )}
        >
          <p
            className={cn(
              'text-2xs uppercase tracking-wider',
              isBalanced ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            Équilibre
          </p>
          <p
            className={cn(
              'mt-0.5 inline-flex items-center gap-1.5 font-medium',
              isBalanced ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            {isBalanced ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Débit = Crédit
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4" />
                Écart détecté
              </>
            )}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-sm">
          <colgroup>
            <col className="w-[110px]" />
            <col />
            <col span={2} className="bg-paper" />
            <col span={2} className="bg-sunk/30" />
            <col span={2} className="bg-paper" />
          </colgroup>
          {/* Header à 2 niveaux : groupe (Ouverture/Mouvement/Solde) puis
              débit/crédit. Réduit drastiquement la charge cognitive sur
              les 8 colonnes de chiffres. */}
          <thead className="sticky top-0 z-10 bg-sunk text-2xs uppercase tracking-wider text-ink-mute shadow-[0_1px_0_0_oklch(var(--line-strong))]">
            <tr>
              <th rowSpan={2} className="px-3 py-2 text-left align-bottom font-medium">
                Compte
              </th>
              <th rowSpan={2} className="px-3 py-2 text-left align-bottom font-medium">
                Libellé
              </th>
              <th
                colSpan={2}
                className="border-l border-line-strong px-3 pb-0 pt-2 text-center font-medium"
              >
                Ouverture
              </th>
              <th
                colSpan={2}
                className="border-l border-line-strong px-3 pb-0 pt-2 text-center font-medium"
              >
                Mouvements
              </th>
              <th
                colSpan={2}
                className="border-l border-line-strong px-3 pb-0 pt-2 text-center font-medium"
              >
                Solde
              </th>
            </tr>
            <tr>
              <th className="border-l border-line-strong px-3 pb-2 pt-0.5 text-right font-medium">
                Débit
              </th>
              <th className="px-3 pb-2 pt-0.5 text-right font-medium">Crédit</th>
              <th className="border-l border-line-strong px-3 pb-2 pt-0.5 text-right font-medium">
                Débit
              </th>
              <th className="px-3 pb-2 pt-0.5 text-right font-medium">Crédit</th>
              <th className="border-l border-line-strong px-3 pb-2 pt-0.5 text-right font-medium">
                Débit
              </th>
              <th className="px-3 pb-2 pt-0.5 text-right font-medium">Crédit</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.accountId} className="border-t border-line hover:bg-sunk/40">
                <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">{row.accountCode}</td>
                <td className="px-3 py-1.5 text-ink">{row.accountLabel}</td>
                <Amount value={row.openingDebit} bordered />
                <Amount value={row.openingCredit} />
                <Amount value={row.periodDebit} bordered emphasis />
                <Amount value={row.periodCredit} emphasis />
                <Amount value={row.endingDebit} bordered />
                <Amount value={row.endingCredit} />
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-accent/30 bg-accent-soft/40 font-medium text-accent-ink">
              <td className="px-3 py-2.5 text-2xs uppercase tracking-wider" colSpan={2}>
                Totaux
              </td>
              <Amount value={report.totals.openingDebit} bordered total />
              <Amount value={report.totals.openingCredit} total />
              <Amount value={report.totals.periodDebit} bordered total />
              <Amount value={report.totals.periodCredit} total />
              <Amount value={report.totals.endingDebit} bordered total />
              <Amount value={report.totals.endingCredit} total />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/**
 * Cellule montant avec traitement uniforme :
 *  - Zéro → tiret cadratin muted (réduit le bruit visuel)
 *  - Bordure gauche entre groupes Ouverture/Mouvement/Solde
 *  - Variant `emphasis` (mouvements) en `text-ink` plein, le reste
 *    en `text-ink-soft` pour hiérarchiser
 *  - Variant `total` pour la ligne de pied de table
 */
function Amount({
  value,
  bordered = false,
  emphasis = false,
  total = false,
}: {
  readonly value: string;
  readonly bordered?: boolean;
  readonly emphasis?: boolean;
  readonly total?: boolean;
}) {
  const numeric = Number(value);
  const isZero = !Number.isFinite(numeric) || numeric === 0;
  return (
    <td
      className={cn(
        'px-3 py-1.5 text-right font-mono tabular-nums',
        bordered && 'border-l border-line',
        total
          ? 'text-accent-ink'
          : isZero
            ? 'text-ink-mute'
            : emphasis
              ? 'text-ink'
              : 'text-ink-soft',
      )}
    >
      {isZero ? '—' : fmt(value)}
    </td>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Chip de variation N vs N-1 — composant clé de la Balance comparative.
 *
 * Affiche un triangle directionnel + le pourcentage d'évolution dans
 * un encart coloré sémantique :
 *   - ▲ vert (accent-soft) si la valeur a augmenté
 *   - ▼ rouge (critical-soft) si elle a baissé
 *   - · gris (sunk) si stable ou non calculable
 *
 * En dessous : la variation absolue en mono tabulaire pour confirmer
 * l'ordre de grandeur. Un % seul peut tromper sur des petits comptes
 * (100% sur 50 FCFA n'est pas significatif).
 *
 * Note OHADA : le sens « favorable » d'une variation dépend de la
 * classe de compte (un débit en hausse en classe 6 = charge en hausse
 * = mauvais). On ne fait PAS cette interprétation ici — montrer la
 * direction brute laisse au comptable son jugement.
 */
function VariationChip({
  variation,
  variationPercent,
}: {
  readonly variation: string;
  readonly variationPercent: string | null;
}) {
  const v = Number(variation);
  const isFinite = Number.isFinite(v);
  const isUp = isFinite && v > 0;
  const isDown = isFinite && v < 0;
  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 font-mono text-2xs tabular-nums',
          isUp
            ? 'border-accent/30 bg-accent-soft text-accent-ink'
            : isDown
              ? 'border-critical/30 bg-critical-soft text-critical-ink'
              : 'border-line-strong bg-sunk text-ink-mute',
        )}
      >
        <span aria-hidden>{isUp ? '▲' : isDown ? '▼' : '·'}</span>
        {variationPercent !== null ? `${variationPercent}%` : '—'}
      </span>
      <span
        className={cn(
          'font-mono text-2xs tabular-nums',
          isUp ? 'text-accent-ink' : isDown ? 'text-critical' : 'text-ink-mute',
        )}
      >
        {isFinite && v !== 0 ? fmt(variation) : '—'}
      </span>
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
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Grand livre</CardTitle>
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
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-sm text-warn-ink">
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
              <span className="text-xs text-accent-ink">
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
          <p className="text-sm text-ink-mute">
            Filtrez puis choisissez un compte (ou tapez son code) et cliquez sur « Afficher ».
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GeneralLedgerTable({ report }: { readonly report: GeneralLedgerReport }) {
  const openingDebitNum = Number(report.opening.openingDebit);
  const openingCreditNum = Number(report.opening.openingCredit);
  // Solde d'ouverture net signé (D − C). Permet d'afficher un seul chiffre
  // clair plutôt que « 10000 D / 0 C » qui fait perdre le sens.
  const openingNet = (openingDebitNum - openingCreditNum).toFixed(2);

  return (
    <div className="space-y-4">
      {/* Identification du compte + résumé période. La carte d'identité
          du compte reste en haut, ancrée et toujours visible quand on
          scrolle dans le détail des écritures. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Compte</p>
          <p className="mt-0.5 font-mono text-base font-medium tabular-nums text-ink">
            {report.accountCode}
          </p>
          <p className="mt-0.5 truncate text-xs text-ink-soft">{report.accountLabel}</p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Période</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.fromDate)} → {formatShortDate(report.toDate)}
          </p>
          <p className="mt-0.5 text-xs text-ink-soft">
            <span className="font-mono tabular-nums">{report.lines.length}</span> ligne
            {report.lines.length > 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Solde ouverture</p>
          <p
            className={cn(
              'mt-0.5 font-mono text-xl font-medium tabular-nums',
              Number(openingNet) < 0 ? 'text-critical-ink' : 'text-ink',
            )}
          >
            {fmt(openingNet)}
          </p>
        </div>
        <div className="bg-accent-soft/60 px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-accent-ink">Solde clôture</p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-accent-ink">
            {fmt(
              (
                Number(report.totals.endingDebit) - Number(report.totals.endingCredit)
              ).toFixed(2),
            )}
          </p>
        </div>
      </div>

      {report.lines.length === 0 ? (
        <div className="rounded-md border border-line bg-sunk/40 px-4 py-6 text-center">
          <p className="text-sm text-ink-soft">
            Aucun mouvement sur la période pour ce compte.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-sunk text-2xs uppercase tracking-wider text-ink-mute shadow-[0_1px_0_0_oklch(var(--line-strong))]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Journal</th>
                <th className="px-3 py-2 text-right font-medium">N°</th>
                <th className="px-3 py-2 text-left font-medium">Libellé</th>
                <th className="px-3 py-2 text-left font-medium">Lettrage</th>
                <th className="border-l border-line-strong px-3 py-2 text-right font-medium">
                  Débit
                </th>
                <th className="px-3 py-2 text-right font-medium">Crédit</th>
                <th className="border-l border-line-strong px-3 py-2 text-right font-medium">
                  Solde
                </th>
              </tr>
            </thead>
            <tbody>
              {report.lines.map((line) => {
                const debitNum = Number(line.debit);
                const creditNum = Number(line.credit);
                const balanceNum = Number(line.runningBalance);
                return (
                  <tr key={line.lineId} className="border-t border-line hover:bg-sunk/40">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums text-ink-soft">
                      {line.entryDate}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-ink-soft">
                      {line.journalCode}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-ink-mute">
                      {line.entryNumber}
                    </td>
                    <td className="px-3 py-1.5 text-ink">{line.description ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">
                      {line.letteringCode ?? (
                        <span className="text-ink-mute">—</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        'border-l border-line px-3 py-1.5 text-right font-mono tabular-nums',
                        debitNum === 0 ? 'text-ink-mute' : 'text-ink',
                      )}
                    >
                      {debitNum === 0 ? '—' : fmt(line.debit)}
                    </td>
                    <td
                      className={cn(
                        'px-3 py-1.5 text-right font-mono tabular-nums',
                        creditNum === 0 ? 'text-ink-mute' : 'text-ink',
                      )}
                    >
                      {creditNum === 0 ? '—' : fmt(line.credit)}
                    </td>
                    <td
                      className={cn(
                        'border-l border-line px-3 py-1.5 text-right font-mono font-medium tabular-nums',
                        balanceNum < 0 ? 'text-critical-ink' : 'text-ink',
                      )}
                    >
                      {fmt(line.runningBalance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-accent/30 bg-accent-soft/40 font-medium text-accent-ink">
                <td className="px-3 py-2.5 text-2xs uppercase tracking-wider" colSpan={5}>
                  Totaux période
                </td>
                <td className="border-l border-accent/30 px-3 py-2.5 text-right font-mono tabular-nums">
                  {fmt(report.totals.periodDebit)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                  {fmt(report.totals.periodCredit)}
                </td>
                <td className="border-l border-accent/30 px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                  {fmt(
                    (
                      Number(report.totals.endingDebit) -
                      Number(report.totals.endingCredit)
                    ).toFixed(2),
                  )}
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
    void api.download(
      `/organizations/${orgId}/reports/comparative-balance.xlsx?${buildSearchParams(submitted).toString()}`,
      'comparative-balance.xlsx',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Balance comparative N / N-1</CardTitle>
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
          <p className="text-sm text-ink-mute">
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
      <div className="rounded-md border border-line bg-sunk/40 px-4 py-6 text-center">
        <p className="text-sm text-ink-soft">
          Aucun mouvement sur les périodes avec ces filtres.
        </p>
      </div>
    );
  }
  const yearN = report.toDate.slice(0, 4);
  const yearNm1 = report.previousToDate.slice(0, 4);

  // Compteurs de comptes en hausse/baisse/stable — donne le pouls de
  // l'exercice en un coup d'œil. Stable = variation nette exactement 0.
  const counts = report.rows.reduce(
    (acc, row) => {
      const v = Number(row.netVariation);
      if (!Number.isFinite(v) || v === 0) acc.stable += 1;
      else if (v > 0) acc.up += 1;
      else acc.down += 1;
      return acc;
    },
    { up: 0, down: 0, stable: 0 },
  );

  return (
    <div className="space-y-4">
      {/* Bandeau récap : périodes comparées + pouls des comptes (hausse,
          baisse, stable). Donne au comptable une lecture diagonale
          instantanée avant de plonger dans la table. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Période N</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.fromDate)} → {formatShortDate(report.toDate)}
          </p>
        </div>
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Période N-1</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink-soft">
            {formatShortDate(report.previousFromDate)} →{' '}
            {formatShortDate(report.previousToDate)}
          </p>
        </div>
        <div className="col-span-2 grid grid-cols-3 gap-px bg-line lg:col-span-2">
          <div className="bg-paper px-4 py-2.5">
            <p className="text-2xs uppercase tracking-wider text-accent-ink">▲ En hausse</p>
            <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-accent-ink">
              {counts.up.toLocaleString('fr-FR')}
            </p>
          </div>
          <div className="bg-paper px-4 py-2.5">
            <p className="text-2xs uppercase tracking-wider text-critical-ink">▼ En baisse</p>
            <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-critical-ink">
              {counts.down.toLocaleString('fr-FR')}
            </p>
          </div>
          <div className="bg-paper px-4 py-2.5">
            <p className="text-2xs uppercase tracking-wider text-ink-mute">· Stables</p>
            <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink-soft">
              {counts.stable.toLocaleString('fr-FR')}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-sm">
          <colgroup>
            <col className="w-[110px]" />
            <col />
            <col span={2} className="bg-sunk/40" />
            <col span={2} className="bg-paper" />
            <col span={2} className="bg-sunk/40" />
            <col className="w-[140px]" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-sunk text-2xs uppercase tracking-wider text-ink-mute shadow-[0_1px_0_0_oklch(var(--line-strong))]">
            <tr>
              <th rowSpan={2} className="px-3 py-2 text-left align-bottom font-medium">
                Compte
              </th>
              <th rowSpan={2} className="px-3 py-2 text-left align-bottom font-medium">
                Intitulé
              </th>
              <th
                colSpan={2}
                className="border-l border-line-strong px-3 pb-0 pt-2 text-center font-medium"
              >
                Mouvement {yearNm1}
              </th>
              <th
                colSpan={2}
                className="border-l border-line-strong px-3 pb-0 pt-2 text-center font-medium"
              >
                Mouvement {yearN}
              </th>
              <th
                colSpan={2}
                className="border-l border-line-strong px-3 pb-0 pt-2 text-center font-medium"
              >
                Solde
              </th>
              <th
                rowSpan={2}
                className="border-l border-line-strong px-3 py-2 text-right align-bottom font-medium"
              >
                Variation N
              </th>
            </tr>
            <tr>
              <th className="border-l border-line-strong px-3 pb-2 pt-0.5 text-right font-medium">
                Débit
              </th>
              <th className="px-3 pb-2 pt-0.5 text-right font-medium">Crédit</th>
              <th className="border-l border-line-strong px-3 pb-2 pt-0.5 text-right font-medium">
                Débit
              </th>
              <th className="px-3 pb-2 pt-0.5 text-right font-medium">Crédit</th>
              <th className="border-l border-line-strong px-3 pb-2 pt-0.5 text-right font-medium">
                Débit
              </th>
              <th className="px-3 pb-2 pt-0.5 text-right font-medium">Crédit</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.accountId} className="border-t border-line hover:bg-sunk/40">
                <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">
                  {row.accountCode}
                </td>
                <td className="px-3 py-1.5 text-ink">{row.accountLabel}</td>
                <Amount value={row.previousPeriodDebit} bordered />
                <Amount value={row.previousPeriodCredit} />
                <Amount value={row.periodDebit} bordered emphasis />
                <Amount value={row.periodCredit} emphasis />
                <Amount value={row.endingDebit} bordered />
                <Amount value={row.endingCredit} />
                <td className="border-l border-line px-3 py-1.5 text-right">
                  <VariationChip
                    variation={row.netVariation}
                    variationPercent={row.netVariationPercent}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-accent/30 bg-accent-soft/40 font-medium text-accent-ink">
              <td className="px-3 py-2.5 text-2xs uppercase tracking-wider" colSpan={2}>
                Totaux
              </td>
              <Amount value={report.totals.previousPeriodDebit} bordered total />
              <Amount value={report.totals.previousPeriodCredit} total />
              <Amount value={report.totals.periodDebit} bordered total />
              <Amount value={report.totals.periodCredit} total />
              <Amount value={report.totals.endingDebit} bordered total />
              <Amount value={report.totals.endingCredit} total />
              <td className="border-l border-accent/30 px-3 py-2.5"></td>
            </tr>
          </tfoot>
        </table>
      </div>
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
    void api.download(
      `/organizations/${orgId}/reports/sig.xlsx?${buildSearchParams(submitted).toString()}`,
      'sig.xlsx',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Soldes Intermédiaires de Gestion (SIG)</CardTitle>
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
          <p className="text-sm text-ink-mute">Choisissez la période puis cliquez sur « Générer ».</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SigTable({ report }: { readonly report: SigReport }) {
  const hasComp = report.previous !== undefined;

  // 3 SIGs phares — VA (XC), EBE (XD), RN (XI) — extraits par code.
  // Si un code manque (exercice non clos, calcul partiel), cellule
  // avec tiret. Ordre = ordre du compte de résultat (haut → bas).
  const va = report.soldes.find((s) => s.code === 'XC');
  const ebe = report.soldes.find((s) => s.code === 'XD');
  const rn = report.soldes.find((s) => s.code === 'XI');

  return (
    <div className="space-y-8">
      {/* Bandeau récap : période + 3 SIGs phares. Le dirigeant ou
          comptable senior cherche ces 3 chiffres en premier. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Période</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.fromDate)} → {formatShortDate(report.toDate)}
          </p>
          {hasComp && report.previous && (
            <p className="mt-0.5 font-mono text-2xs tabular-nums text-ink-mute">
              vs {formatShortDate(report.previous.fromDate)} →{' '}
              {formatShortDate(report.previous.toDate)}
            </p>
          )}
        </div>
        <SoldeHighlight label="Valeur ajoutée" code="XC" solde={va} hasComp={hasComp} />
        <SoldeHighlight label="EBE" code="XD" solde={ebe} hasComp={hasComp} />
        <SoldeHighlight label="Résultat net" code="XI" solde={rn} hasComp={hasComp} emphasis />
      </div>

      {/* Cascade des soldes — empilement vertical avec ligne de liaison
          subtile à gauche, matérialise la chaîne de dérivation XA → XI.
          Le solde final (XI = RN) reçoit un encart accent-soft. */}
      <section>
        <header className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
          <h3 className="font-display text-lg font-medium tracking-tight text-ink">
            Cascade des soldes
          </h3>
          <span className="font-mono text-xs tabular-nums text-ink-mute">
            {report.soldes.length} étapes · XA → XI
          </span>
        </header>
        <ol className="relative space-y-2 pl-8">
          <span
            aria-hidden
            className="absolute bottom-3 left-3 top-3 w-px bg-line-strong"
          />
          {report.soldes.map((s, idx) => {
            const isFinal = s.code === 'XI';
            const variationNum = s.variation === undefined ? null : Number(s.variation);
            const variationPct = s.variationPercent ?? null;
            const isPositiveVar = variationNum !== null && variationNum > 0;
            const isNegativeVar = variationNum !== null && variationNum < 0;
            return (
              <li key={s.code} className="relative">
                <span
                  aria-hidden
                  className={cn(
                    'absolute -left-8 top-3 flex h-6 w-6 items-center justify-center rounded-full border font-mono text-2xs font-medium tabular-nums',
                    isFinal
                      ? 'border-accent bg-accent text-paper'
                      : 'border-line-strong bg-paper text-ink-soft',
                  )}
                >
                  {idx + 1}
                </span>
                <article
                  className={cn(
                    'flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border bg-paper px-4 py-3',
                    isFinal ? 'border-accent/40 bg-accent-soft/40' : 'border-line',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          'font-mono text-xs font-semibold tabular-nums',
                          isFinal ? 'text-accent-ink' : 'text-ink-soft',
                        )}
                      >
                        {s.code}
                      </span>
                      <span
                        className={cn(
                          'text-sm font-medium',
                          isFinal ? 'text-accent-ink' : 'text-ink',
                        )}
                      >
                        {s.label}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-2xs leading-snug text-ink-mute">
                      = {s.formula}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={cn(
                        'font-mono text-xl font-medium tabular-nums tracking-tight',
                        isFinal ? 'text-accent-ink' : 'text-ink',
                      )}
                    >
                      {fmt(s.amount)}
                    </span>
                    {hasComp && (
                      <div className="flex items-baseline gap-2 text-xs">
                        <span className="font-mono tabular-nums text-ink-mute">
                          N-1 {fmt(s.previousAmount ?? '0')}
                        </span>
                        {variationPct !== null && (
                          <span
                            className={cn(
                              'inline-flex items-center gap-0.5 rounded-xs border px-1.5 py-0.5 font-mono text-2xs tabular-nums',
                              isPositiveVar
                                ? 'border-accent/30 bg-accent-soft text-accent-ink'
                                : isNegativeVar
                                  ? 'border-critical/30 bg-critical-soft text-critical-ink'
                                  : 'border-line-strong bg-sunk text-ink-soft',
                            )}
                          >
                            {isPositiveVar ? '▲' : isNegativeVar ? '▼' : '·'} {variationPct}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <SigPosteTable
          title="Produits"
          subtitle="TA → TO"
          postes={report.produits}
          hasComp={hasComp}
        />
        <SigPosteTable
          title="Charges"
          subtitle="RA → RS"
          postes={report.charges}
          hasComp={hasComp}
        />
      </div>
    </div>
  );
}

/**
 * Cellule du bandeau récap : 1 solde phare avec montant N, montant N-1
 * et variation % chip. Variant `emphasis` pour le Résultat Net (chiffre
 * regardé en premier) — fond accent-soft pour le distinguer.
 */
function SoldeHighlight({
  label,
  code,
  solde,
  hasComp,
  emphasis = false,
}: {
  readonly label: string;
  readonly code: string;
  readonly solde: SoldeIntermediaire | undefined;
  readonly hasComp: boolean;
  readonly emphasis?: boolean;
}) {
  const amount = solde?.amount;
  const num = amount === undefined ? null : Number(amount);
  const variationNum = solde?.variation === undefined ? null : Number(solde.variation);
  const isNegativeAmount = num !== null && num < 0;
  return (
    <div className={cn('px-4 py-3', emphasis ? 'bg-accent-soft/60' : 'bg-paper')}>
      <p
        className={cn(
          'flex items-baseline gap-1.5 text-2xs uppercase tracking-wider',
          emphasis ? 'text-accent-ink' : 'text-ink-mute',
        )}
      >
        {label}
        <span className="font-mono normal-case tracking-normal text-ink-mute/80">
          ({code})
        </span>
      </p>
      <p
        className={cn(
          'mt-0.5 font-mono text-xl font-medium tabular-nums',
          amount === undefined
            ? 'text-ink-mute'
            : isNegativeAmount
              ? 'text-critical-ink'
              : emphasis
                ? 'text-accent-ink'
                : 'text-ink',
        )}
      >
        {amount === undefined ? '—' : fmt(amount)}
      </p>
      {hasComp && solde?.variationPercent && (
        <p
          className={cn(
            'mt-0.5 font-mono text-2xs tabular-nums',
            variationNum !== null && variationNum > 0
              ? 'text-accent-ink'
              : variationNum !== null && variationNum < 0
                ? 'text-critical'
                : 'text-ink-mute',
          )}
        >
          {variationNum !== null && variationNum > 0
            ? '▲'
            : variationNum !== null && variationNum < 0
              ? '▼'
              : '·'}{' '}
          {solde.variationPercent}% vs N-1
        </p>
      )}
    </div>
  );
}

function SigPosteTable({
  title,
  subtitle,
  postes,
  hasComp,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly postes: ReadonlyArray<{
    readonly code: string;
    readonly label: string;
    readonly amount: string;
    readonly previousAmount?: string;
  }>;
  readonly hasComp: boolean;
}) {
  return (
    <section>
      <header className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
        <h4 className="font-display text-base font-medium tracking-tight text-ink">
          {title}
        </h4>
        <span className="font-mono text-xs tabular-nums text-ink-mute">{subtitle}</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-ink-mute">
          {postes.length}
        </span>
      </header>
      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Réf.</th>
              <th className="px-3 py-2 text-left font-medium">Libellé</th>
              <th className="px-3 py-2 text-right font-medium">N</th>
              {hasComp ? (
                <th className="px-3 py-2 text-right font-medium">N-1</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {postes.map((p) => (
              <tr key={p.code} className="border-t border-line hover:bg-sunk/40">
                <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">{p.code}</td>
                <td className="px-3 py-1.5 text-xs text-ink">{p.label}</td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink">
                  {fmt(p.amount)}
                </td>
                {hasComp ? (
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink-mute">
                    {fmt(p.previousAmount ?? '0')}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
    void api.download(
      `/organizations/${orgId}/reports/multi-year-balance.xlsx?${buildParams(submitted).toString()}`,
      'multi-year-balance.xlsx',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Balance pluri-exercices</CardTitle>
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
    return <p className="text-sm text-ink-mute">Aucun mouvement sur ces périodes.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-sunk text-left text-2xs uppercase tracking-wider text-ink-mute">
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
            <tr key={row.accountId} className="border-t border-line hover:bg-sunk/40">
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
    void api.download(
      `/organizations/${orgId}/reports/aging-balance.xlsx?${buildParams(submitted).toString()}`,
      'aging-balance.xlsx',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Balance âgée</CardTitle>
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
      <div className="rounded-md border border-line bg-sunk/40 px-4 py-6 text-center">
        <p className="text-sm text-ink-soft">
          Aucun en-cours {report.side === 'CLIENT' ? 'client' : 'fournisseur'} ouvert à cette date.
        </p>
      </div>
    );
  }
  const bucketLabels = (report.rows[0]?.buckets ?? []).map((b) => b.label);
  const numBuckets = bucketLabels.length;

  // Total des comptes "critiques" : ceux ayant un montant > 0 dans le
  // dernier bucket (le plus ancien). C'est l'alerte recouvrement.
  const criticalCount = report.rows.filter(
    (r) => Number(r.buckets[numBuckets - 1]?.amount ?? '0') > 0,
  ).length;
  const criticalTotal = report.rows
    .filter((r) => Number(r.buckets[numBuckets - 1]?.amount ?? '0') > 0)
    .reduce((s, r) => s + Number(r.buckets[numBuckets - 1]?.amount ?? '0'), 0)
    .toFixed(2);

  // Échelle de gris/teinte par bucket — heatmap discrète. Premier
  // bucket = neutre (à jour), dernier = critical-soft (impayé long).
  // Les buckets intermédiaires gradient warn → critical. C'est ce qui
  // permet au comptable de voir le risque de recouvrement en diagonale.
  const bucketTone = (idx: number, amount: string): string => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) return 'text-ink-mute';
    if (idx === 0) return 'text-ink';
    if (idx === numBuckets - 1) return 'bg-critical-soft/40 text-critical-ink font-semibold';
    if (idx === numBuckets - 2) return 'bg-warn-soft/30 text-warn-ink';
    return 'text-ink';
  };

  return (
    <div className="space-y-4">
      {/* Bandeau récap : côté + date + total + alerte recouvrement. La
          cellule « En souffrance » bascule en critical-soft dès qu'un
          compte traîne dans le dernier bucket. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Côté</p>
          <p className="mt-0.5 text-sm font-medium text-ink">
            {report.side === 'CLIENT' ? 'Clients' : 'Fournisseurs'}
          </p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Arrêté au</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.asAtDate)}
          </p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Total en-cours</p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
            {fmt(report.grandTotal)}
          </p>
        </div>
        <div
          className={cn(
            'px-4 py-3',
            criticalCount > 0 ? 'bg-critical-soft' : 'bg-accent-soft/60',
          )}
        >
          <p
            className={cn(
              'text-2xs uppercase tracking-wider',
              criticalCount > 0 ? 'text-critical-ink' : 'text-accent-ink',
            )}
          >
            {criticalCount > 0 ? '▲ En souffrance' : 'Tout à jour'}
          </p>
          <p
            className={cn(
              'mt-0.5 font-mono text-xl font-medium tabular-nums',
              criticalCount > 0 ? 'text-critical-ink' : 'text-accent-ink',
            )}
          >
            {criticalCount > 0 ? fmt(criticalTotal) : '—'}
          </p>
          {criticalCount > 0 && (
            <p className="mt-0.5 text-2xs text-critical-ink/80">
              <span className="font-mono tabular-nums">{criticalCount}</span> compte
              {criticalCount > 1 ? 's' : ''} en {bucketLabels[numBuckets - 1]}
            </p>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-sunk text-2xs uppercase tracking-wider text-ink-mute shadow-[0_1px_0_0_oklch(var(--line-strong))]">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Compte</th>
              <th className="px-3 py-2 text-left font-medium">Intitulé</th>
              {bucketLabels.map((lab, i) => (
                <th
                  key={i}
                  className={cn(
                    'px-3 py-2 text-right font-medium',
                    i === numBuckets - 1 && 'text-critical-ink',
                    i === numBuckets - 2 && 'text-warn-ink',
                  )}
                >
                  {lab}
                </th>
              ))}
              <th className="border-l border-line-strong px-3 py-2 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.accountId} className="border-t border-line hover:bg-sunk/40">
                <td className="px-3 py-1.5 font-mono text-xs text-ink-soft">
                  {row.accountCode}
                </td>
                <td className="px-3 py-1.5 text-ink">{row.accountLabel}</td>
                {row.buckets.map((b, i) => {
                  const num = Number(b.amount);
                  const isZero = !Number.isFinite(num) || num === 0;
                  return (
                    <td
                      key={i}
                      className={cn(
                        'px-3 py-1.5 text-right font-mono tabular-nums',
                        bucketTone(i, b.amount),
                      )}
                    >
                      {isZero ? '—' : fmt(b.amount)}
                    </td>
                  );
                })}
                <td className="border-l border-line px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-ink">
                  {fmt(row.total)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-accent/30 bg-accent-soft/40 font-medium text-accent-ink">
              <td className="px-3 py-2.5 text-2xs uppercase tracking-wider" colSpan={2}>
                Totaux par tranche
              </td>
              {report.bucketTotals.map((t, i) => (
                <td
                  key={i}
                  className="px-3 py-2.5 text-right font-mono tabular-nums"
                >
                  {fmt(t)}
                </td>
              ))}
              <td className="border-l border-accent/30 px-3 py-2.5 text-right font-mono font-semibold tabular-nums">
                {fmt(report.grandTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
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
    void api.download(
      `/organizations/${orgId}/reports/cash-trend.xlsx?${buildParams(submitted).toString()}`,
      'cash-trend.xlsx',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Trésorerie nette glissante</CardTitle>
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
            <tr className="bg-sunk text-left text-2xs uppercase tracking-wider text-ink-mute">
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
                <tr key={p.yearMonth} className="border-t border-line hover:bg-sunk/40">
                  <td className="px-2 py-1 font-mono text-xs">{p.yearMonth}</td>
                  <td className="px-2 py-1 text-xs text-ink-mute">{p.asAtDate}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(p.totalDebit)}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(p.totalCredit)}</td>
                  <td
                    className={`px-2 py-1 text-right font-mono font-semibold ${
                      net < 0 ? 'text-critical' : 'text-ink'
                    }`}
                  >
                    {fmt(p.netCash)}
                  </td>
                  <td
                    className={`px-2 py-1 text-right font-mono ${
                      change !== null && change < 0
                        ? 'text-critical'
                        : change !== null && change > 0
                          ? 'text-accent'
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
    <div className="rounded-md border border-line bg-sunk/40 p-3">
      <div className="text-2xs uppercase tracking-wider text-ink-mute">{label}</div>
      <div
        className={`mt-1 font-mono text-lg font-semibold ${
          num < 0 ? 'text-critical' : 'text-ink'
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
    void api.download(
      `/organizations/${orgId}/reports/financial-ratios.xlsx?${buildSearchParams(submitted).toString()}`,
      'financial-ratios.xlsx',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Ratios financiers</CardTitle>
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
  // Subtitle métier par famille — donne le sens de la catégorie en une ligne.
  // Pas un dictionnaire OHADA officiel, juste l'aide de scan pour le comptable.
  const subtitleByCategory: Record<(typeof groups)[number], string> = {
    STRUCTURE: 'Composition du financement long terme (capitaux propres / dettes).',
    LIQUIDITE: 'Capacité à honorer les engagements à court terme.',
    SOLVABILITE: 'Couverture des dettes par le patrimoine — vue créancier.',
    RENTABILITE: 'Marges et retour sur les capitaux investis.',
    ACTIVITE: 'Vitesse de rotation des stocks, clients, fournisseurs.',
  };
  const iconByCategory: Record<(typeof groups)[number], React.ReactNode> = {
    STRUCTURE: <Landmark className="h-4 w-4" strokeWidth={1.5} />,
    LIQUIDITE: <Wallet className="h-4 w-4" strokeWidth={1.5} />,
    SOLVABILITE: <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />,
    RENTABILITE: <TrendingUp className="h-4 w-4" strokeWidth={1.5} />,
    ACTIVITE: <Calculator className="h-4 w-4" strokeWidth={1.5} />,
  };

  return (
    <div className="space-y-8">
      {/* Bandeau récapitulatif — rappel de la période + total des ratios
          calculés. Sans cela, après scroll, le comptable perd le contexte
          de la date d'arrêté. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Arrêté au</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.asAtDate)}
          </p>
        </div>
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Début exercice</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.fiscalYearStartDate)}
          </p>
        </div>
        <div className="col-span-2 bg-paper px-4 py-2.5 sm:col-span-1">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Indicateurs calculés</p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
            {report.ratios.length.toLocaleString('fr-FR')}{' '}
            <span className="text-xs font-normal text-ink-mute">
              sur {groups.length} familles
            </span>
          </p>
        </div>
      </div>

      {groups.map((cat) => {
        const items = report.ratios.filter((r) => r.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat}>
            <header className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
              <span className="text-ink-mute">{iconByCategory[cat]}</span>
              <h3 className="font-display text-lg font-medium leading-tight tracking-tight text-ink">
                {labelByCategory[cat]}
              </h3>
              <span className="font-mono text-xs tabular-nums text-ink-mute">
                {items.length}
              </span>
              <p className="ml-auto hidden text-xs text-ink-soft sm:block">
                {subtitleByCategory[cat]}
              </p>
            </header>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((r) => (
                <RatioCard key={r.code} ratio={r} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Carte d'un ratio unique — la valeur est l'élément central, mise en
 * monospace tabulaire taille display pour scan rapide. La formule
 * reste en bas en muted (consultative, pas dominante). L'interprétation
 * apparaît comme footer séparé par une ligne fine quand elle existe.
 *
 * Pas de coloration par seuil (bon/mauvais) — la donnée brute parle au
 * comptable, et un rouge automatique sur « endettement > 70% » serait
 * trompeur sans contexte sectoriel. L'interpretation textuelle suffit.
 */
function RatioCard({ ratio }: { readonly ratio: FinancialRatio }) {
  const { value, unit } = formatRatioValue(ratio);
  const hasValue = ratio.value !== null;
  return (
    <article className="flex flex-col gap-3 rounded-md border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-2xs uppercase tracking-wider text-ink-mute">
            {ratio.code}
          </p>
          <p className="mt-0.5 text-sm font-medium leading-tight text-ink">{ratio.label}</p>
        </div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-mono tabular-nums tracking-tight',
            hasValue ? 'text-3xl font-medium text-ink' : 'text-2xl font-medium text-ink-mute',
          )}
        >
          {value}
        </span>
        {unit && hasValue && (
          <span className="text-sm font-normal text-ink-mute">{unit}</span>
        )}
      </div>
      <p className="font-mono text-2xs leading-snug text-ink-mute">
        <span className="text-ink-soft">= </span>
        {ratio.formula}
      </p>
      {ratio.interpretation && (
        <p className="border-t border-line pt-2 text-xs leading-snug text-ink-soft">
          {ratio.interpretation}
        </p>
      )}
    </article>
  );
}

/**
 * Formate la valeur d'un ratio en (string affichée, unité séparée).
 *   - PERCENT : 12,34 puis « % » à part (laisse respirer le chiffre)
 *   - DAYS    : 45 puis « j »
 *   - RATIO   : 1,23 sans suffixe (les ratios purs n'ont pas d'unité)
 *   - null    : tiret cadratin
 */
function formatRatioValue(ratio: FinancialRatio): { value: string; unit: string | null } {
  if (ratio.value === null) {
    return { value: '—', unit: null };
  }
  const n = Number(ratio.value);
  if (!Number.isFinite(n)) {
    return { value: ratio.value, unit: null };
  }
  const formatted = n.toLocaleString('fr-FR', {
    minimumFractionDigits: ratio.unit === 'DAYS' ? 0 : 2,
    maximumFractionDigits: ratio.unit === 'DAYS' ? 0 : 2,
  });
  if (ratio.unit === 'PERCENT') return { value: formatted, unit: '%' };
  if (ratio.unit === 'DAYS') return { value: formatted, unit: 'j' };
  return { value: formatted, unit: null };
}

// ─── TFT (Tableau Flux Trésorerie) — codes Z Tome 3 p.34 ──────────────
//
// Refonte B3 : consomme le nouveau shape `CashFlowReport` (vague A).
// Présentation conforme doctrine SYSCOHADA Révisé : ouverture ZA, 4
// sections détaillées (ZB, ZC, ZD, ZE), totaux ZF/ZG/ZH, contrôle de
// cohérence et colonne comparative N-1.

type CashFlowSubmitted = {
  readonly fromDate: string;
  readonly toDate: string;
  readonly compareEnabled: boolean;
  readonly previousFromDate: string;
  readonly previousToDate: string;
};

function TftPanel({ orgId }: { readonly orgId: string }) {
  const [fromDate, setFromDate] = useState<string>(yearStartIso());
  const [toDate, setToDate] = useState<string>(todayIso());
  const [compareEnabled, setCompareEnabled] = useState<boolean>(true);
  const [previousFromDate, setPreviousFromDate] = useState<string>(previousYearStartIso());
  const [previousToDate, setPreviousToDate] = useState<string>(previousYearEndIso());
  const [submitted, setSubmitted] = useState<CashFlowSubmitted | null>(null);

  const buildParams = (s: CashFlowSubmitted): URLSearchParams => {
    const params = new URLSearchParams({ fromDate: s.fromDate, toDate: s.toDate });
    if (s.compareEnabled) {
      params.set('previousFromDate', s.previousFromDate);
      params.set('previousToDate', s.previousToDate);
    }
    return params;
  };

  const query = useQuery<CashFlowReport, ApiError>({
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
    void api.download(
      `/organizations/${orgId}/reports/tft.xlsx?${buildParams(submitted).toString()}`,
      'tft.xlsx',
    );
  };

  const downloadPdf = (): void => {
    if (submitted === null) return;
    void api.download(
      `/organizations/${orgId}/reports/tft.pdf?${buildParams(submitted).toString()}`,
      'tft.pdf',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">
          TFT — Tableau des Flux de Trésorerie
        </CardTitle>
        <CardDescription>
          Méthode indirecte conforme SYSCOHADA Révisé (Tome 3 page 34).
          Nomenclature officielle des codes Z : <strong>ZA</strong> ouverture,
          <strong> ZB</strong> opérationnel, <strong>ZC</strong> investissement,
          <strong> ZD</strong> financement capitaux propres, <strong>ZE</strong> capitaux
          étrangers, <strong>ZF</strong> total financement, <strong>ZG</strong> variation,
          <strong> ZH</strong> clôture. Devise : <span className="font-mono">XOF</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        <form
          className="grid gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted({
              fromDate,
              toDate,
              compareEnabled,
              previousFromDate,
              previousToDate,
            });
          }}
        >
          <FilterGroup title="Période" subtitle="Exercice de référence">
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="tft-from" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Du
                </Label>
                <Input
                  id="tft-from"
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tft-to" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Au
                </Label>
                <Input
                  id="tft-to"
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  required
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
            </div>
          </FilterGroup>

          <FilterGroup title="Comparaison N-1" subtitle="Période antérieure">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex h-9 cursor-pointer items-center gap-2 self-end whitespace-nowrap rounded-sm border border-line-strong bg-paper px-3 text-sm text-ink-soft transition-colors hover:bg-sunk has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink">
                <input
                  type="checkbox"
                  checked={compareEnabled}
                  onChange={(e) => setCompareEnabled(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Activer
              </label>
              <div className="space-y-1">
                <Label htmlFor="tft-prev-from" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Du N-1
                </Label>
                <Input
                  id="tft-prev-from"
                  type="date"
                  value={previousFromDate}
                  onChange={(e) => setPreviousFromDate(e.target.value)}
                  disabled={!compareEnabled}
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="tft-prev-to" className="text-2xs uppercase tracking-wider text-ink-soft">
                  Au N-1
                </Label>
                <Input
                  id="tft-prev-to"
                  type="date"
                  value={previousToDate}
                  onChange={(e) => setPreviousToDate(e.target.value)}
                  disabled={!compareEnabled}
                  className="h-9 w-40 font-mono tabular-nums"
                />
              </div>
            </div>
          </FilterGroup>

          <div className="flex flex-col items-stretch gap-1 lg:items-end">
            <span className="select-none text-2xs uppercase tracking-wider text-transparent">.</span>
            <div className="flex flex-wrap items-end gap-2">
              <Button type="submit" disabled={query.isFetching} className="h-9">
                {query.isFetching ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wallet className="mr-2 h-4 w-4" strokeWidth={1.5} />
                )}
                Générer le TFT
              </Button>
              {query.data !== undefined && (
                <>
                  <Button type="button" variant="outline" onClick={downloadXlsx}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    XLSX
                  </Button>
                  <Button type="button" variant="outline" onClick={downloadPdf}>
                    <FileText className="mr-2 h-4 w-4" />
                    PDF
                  </Button>
                </>
              )}
            </div>
          </div>
        </form>

        {query.isError ? <FormError error={query.error} /> : null}

        {query.data !== undefined ? (
          <CashFlowView report={query.data} />
        ) : submitted === null ? (
          <div className="rounded-md border border-line bg-sunk/40 px-4 py-6 text-center">
            <p className="text-sm text-ink-soft">
              Choisir la période puis cliquer sur{' '}
              <span className="font-medium text-ink">Générer le TFT</span>.
            </p>
            <p className="mt-1 text-xs text-ink-mute">
              Par défaut, exercice ouvert au 1<sup>er</sup> janvier comparé à l&apos;exercice
              précédent.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Vue principale : 1 ligne ZA + 4 sections (ZB-ZE) + 3 totaux (ZF-ZH)
 * + contrôle cohérence. 4 colonnes : Réf | Libellé | Montant N | Montant N-1.
 * Sous-totaux Z en gras avec accent visuel. Sections introduites par
 * un titre uppercase + filet de séparation (doctrine Tome 3 p.34).
 */
function CashFlowView({ report }: { readonly report: CashFlowReport }) {
  const variationNum = Number(report.netCashVariation);
  const isPositive = Number.isFinite(variationNum) && variationNum > 0;
  const isNegative = Number.isFinite(variationNum) && variationNum < 0;
  const coherenceNum = Number(report.coherenceCheck);
  const coherenceOk = Number.isFinite(coherenceNum) && Math.abs(coherenceNum) <= 1;

  return (
    <div className="space-y-6">
      {/* Bandeau récap : ZA → ZG → ZH, mécanique cash en 1 coup d'œil. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line lg:grid-cols-4">
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">Période</p>
          <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">
            {formatShortDate(report.fromDate)} → {formatShortDate(report.toDate)}
          </p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">
            ZA · Trésorerie 1<sup>er</sup> janvier
          </p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
            {fmt(report.openingCash)}
          </p>
        </div>
        <div
          className={cn(
            'px-4 py-3',
            isPositive
              ? 'bg-accent-soft/60'
              : isNegative
                ? 'bg-critical-soft'
                : 'bg-sunk/60',
          )}
        >
          <p
            className={cn(
              'text-2xs uppercase tracking-wider',
              isPositive
                ? 'text-accent-ink'
                : isNegative
                  ? 'text-critical-ink'
                  : 'text-ink-mute',
            )}
          >
            {isPositive ? '▲' : isNegative ? '▼' : '·'} ZG · Variation nette
          </p>
          <p
            className={cn(
              'mt-0.5 font-mono text-xl font-medium tabular-nums',
              isPositive
                ? 'text-accent-ink'
                : isNegative
                  ? 'text-critical-ink'
                  : 'text-ink-soft',
            )}
          >
            {fmt(report.netCashVariation)}
          </p>
        </div>
        <div className="bg-paper px-4 py-3">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">
            ZH · Trésorerie 31 décembre
          </p>
          <p className="mt-0.5 font-mono text-xl font-medium tabular-nums text-ink">
            {fmt(report.closingCash)}
          </p>
        </div>
      </div>

      {/* Tableau structuré 4 colonnes — Réf | Libellé | Montant N | N-1. */}
      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-sm">
          <thead className="bg-sunk text-2xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="w-16 px-3 py-2 text-left font-medium">Réf.</th>
              <th className="px-3 py-2 text-left font-medium">Libellé</th>
              <th className="w-40 px-3 py-2 text-right font-medium">
                Montant N
                <span className="ml-1 font-mono text-2xs text-ink-mute">(XOF)</span>
              </th>
              <th className="w-40 px-3 py-2 text-right font-medium">
                Montant N-1
                <span className="ml-1 font-mono text-2xs text-ink-mute">(XOF)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {/* ZA — ouverture, ligne pleine largeur en haut. */}
            <CashFlowTotalRow
              code="ZA"
              label="Trésorerie nette au 1er janvier"
              amount={report.openingCash}
              previous={report.previous?.openingCash}
              tone="neutral-strong"
            />

            <CashFlowSectionRows
              section={report.operatingFlows}
              sectionTitle="Flux de trésorerie provenant des activités opérationnelles"
              previousSubtotal={report.previous?.operatingFlow}
              tone="info"
            />
            <CashFlowSectionRows
              section={report.investingFlows}
              sectionTitle="Flux de trésorerie provenant des opérations d'investissement"
              previousSubtotal={report.previous?.investingFlow}
              tone="warn"
            />
            <CashFlowSectionRows
              section={report.financingFlowsEquity}
              sectionTitle="Flux de trésorerie provenant du financement par les capitaux propres"
              previousSubtotal={report.previous?.financingFlowEquity}
              tone="accent"
            />
            <CashFlowSectionRows
              section={report.financingFlowsDebt}
              sectionTitle="Trésorerie provenant du financement par les capitaux étrangers"
              previousSubtotal={report.previous?.financingFlowDebt}
              tone="accent"
            />

            {/* Totaux ZF, ZG, ZH — encadrés visuels. */}
            <CashFlowTotalRow
              code="ZF"
              label="Flux de trésorerie provenant des activités de financement (D + E)"
              amount={report.financingFlowsTotal}
              previous={report.previous?.financingFlowTotal}
              tone="accent"
            />
            <CashFlowTotalRow
              code="ZG"
              label="VARIATION DE LA TRÉSORERIE NETTE DE LA PÉRIODE (B + C + F)"
              amount={report.netCashVariation}
              previous={report.previous?.netCashVariation}
              tone="strong"
            />
            <CashFlowTotalRow
              code="ZH"
              label="Trésorerie nette au 31 décembre (G + A)"
              amount={report.closingCash}
              previous={report.previous?.closingCash}
              tone="strong"
            />
          </tbody>
        </table>
      </div>

      {/* Contrôle de cohérence : ZH calculé ≈ trésorerie comptes classe 5. */}
      <div
        className={cn(
          'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
          coherenceOk
            ? 'border-info/30 bg-info-soft/30 text-info-ink'
            : 'border-critical/40 bg-critical-soft/40 text-critical-ink',
        )}
      >
        {coherenceOk ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
        )}
        <div>
          <p className="font-medium">
            Contrôle de cohérence : |ZH calculé − trésorerie comptes classe 5|
          </p>
          <p className="mt-0.5 font-mono tabular-nums">
            écart = {fmt(report.coherenceCheck)} XOF —{' '}
            {coherenceOk
              ? 'cohérent (≤ 1 FCFA).'
              : 'défaut de mapping ou compte non classé : vérifier le PCG (classe 5).'}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Sous-bloc de lignes d'une section ZB/ZC/ZD/ZE : un en-tête de section
 * (titre uppercase + filet), les postes FA-FQ, puis le sous-total Z.
 */
function CashFlowSectionRows({
  section,
  sectionTitle,
  previousSubtotal,
  tone,
}: {
  readonly section: CashFlowSection;
  readonly sectionTitle: string;
  readonly previousSubtotal?: string;
  readonly tone: 'info' | 'warn' | 'accent';
}) {
  const toneClasses: Record<typeof tone, { dot: string; subtotal: string }> = {
    info: {
      dot: 'bg-info',
      subtotal: 'border-y border-info/30 bg-info-soft/40 text-info-ink',
    },
    warn: {
      dot: 'bg-warn',
      subtotal: 'border-y border-warn/30 bg-warn-soft/40 text-warn-ink',
    },
    accent: {
      dot: 'bg-accent',
      subtotal: 'border-y border-accent/30 bg-accent-soft/40 text-accent-ink',
    },
  };
  const t = toneClasses[tone];

  return (
    <>
      {/* En-tête de section — pleine largeur, uppercase, filet visuel. */}
      <tr className="border-t-2 border-line-strong bg-sunk/50">
        <td className="px-3 py-2" colSpan={4}>
          <div className="flex items-center gap-2">
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />
            <span className="text-2xs font-medium uppercase tracking-wider text-ink">
              {sectionTitle}
            </span>
          </div>
        </td>
      </tr>

      {/* Postes de détail : FA-FQ. */}
      {section.postes.map((poste) => {
        const n = Number(poste.amount);
        const isZero = !Number.isFinite(n) || n === 0;
        return (
          <tr key={poste.code} className="border-t border-line">
            <td className="px-3 py-1.5 font-mono text-xs text-ink-mute">{poste.code}</td>
            <td className="px-3 py-1.5 pl-6 text-xs text-ink-soft">
              {poste.label}
              {poste.source !== undefined && poste.source !== '' ? (
                <span className="ml-2 font-mono text-2xs text-ink-mute">
                  · {poste.source}
                </span>
              ) : null}
            </td>
            <td
              className={cn(
                'px-3 py-1.5 text-right font-mono tabular-nums',
                isZero ? 'text-ink-mute' : 'text-ink',
              )}
            >
              {isZero ? '—' : fmt(poste.amount)}
            </td>
            <td className="px-3 py-1.5 text-right font-mono text-ink-mute tabular-nums">
              {/* N-1 non détaillé en doctrine : on n'affiche rien par poste. */}
              —
            </td>
          </tr>
        );
      })}

      {/* Sous-total Z de section — gras + accent. */}
      <tr className={cn('font-medium', t.subtotal)}>
        <td className="px-3 py-2 font-mono text-xs font-semibold">{section.code}</td>
        <td className="px-3 py-2 text-2xs uppercase tracking-wider">{section.label}</td>
        <td className="px-3 py-2 text-right font-mono text-base tabular-nums">
          {fmt(section.subtotal)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-base tabular-nums">
          {previousSubtotal !== undefined ? fmt(previousSubtotal) : '—'}
        </td>
      </tr>
    </>
  );
}

/**
 * Ligne de total (ZA, ZF, ZG, ZH) — pleine largeur, sans détail de postes.
 * `tone='strong'` (ZG, ZH) = couleur ink soutenue ; `accent` (ZF) = teinte
 * accent ; `neutral-strong` (ZA) = bandeau sombre supérieur.
 */
function CashFlowTotalRow({
  code,
  label,
  amount,
  previous,
  tone,
}: {
  readonly code: string;
  readonly label: string;
  readonly amount: string;
  readonly previous?: string;
  readonly tone: 'neutral-strong' | 'strong' | 'accent';
}) {
  const toneClasses: Record<typeof tone, string> = {
    'neutral-strong': 'border-y-2 border-line-strong bg-sunk text-ink',
    strong: 'border-y-2 border-line-strong bg-paper font-semibold text-ink',
    accent: 'border-y border-accent/30 bg-accent-soft/30 text-accent-ink',
  };
  return (
    <tr className={cn('font-medium', toneClasses[tone])}>
      <td className="px-3 py-2.5 font-mono text-sm font-semibold">{code}</td>
      <td className="px-3 py-2.5 text-sm uppercase tracking-wide">{label}</td>
      <td className="px-3 py-2.5 text-right font-mono text-base tabular-nums">
        {fmt(amount)}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-base tabular-nums">
        {previous !== undefined ? fmt(previous) : '—'}
      </td>
    </tr>
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
    void api.download(
      `/organizations/${orgId}/reports/annexe.xlsx?${buildParams(submitted).toString()}`,
      'annexe.xlsx',
    );
  };

  return (
    <Card className="border-line bg-paper shadow-none">
      <CardHeader className="border-b border-line">
        <CardTitle className="font-display text-2xl font-medium tracking-tight">Annexe — Notes 1 à 36 SYSCOHADA AUDCIF</CardTitle>
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
    COMPUTED: 'bg-accent-soft text-accent-ink border border-accent/30',
    PARTIAL: 'bg-warn-soft text-warn-ink border border-warn/30',
    MANUAL: 'bg-sunk text-ink-soft border border-line-strong',
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
        <span className="rounded-xs border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-2xs uppercase tracking-wider text-accent-ink">
          {counts.COMPUTED ?? 0} COMPUTED
        </span>
        <span className="rounded-xs border border-warn/30 bg-warn-soft px-2.5 py-0.5 text-2xs uppercase tracking-wider text-warn-ink">
          {counts.PARTIAL ?? 0} PARTIAL
        </span>
        <span className="rounded-xs border border-line-strong bg-sunk px-2.5 py-0.5 text-2xs uppercase tracking-wider text-ink-soft">
          {counts.MANUAL ?? 0} MANUAL
        </span>
        <span className="text-ink-mute">
          • Cliquer sur une note pour afficher son détail (7 notes implémentées : 3A, 3B, 5, 14, 15, 20, 28)
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-sunk text-left text-2xs uppercase tracking-wider text-ink-mute">
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
                    className={`border-b ${supported ? 'cursor-pointer hover:bg-sunk' : 'hover:bg-sunk'} ${isExpanded ? 'bg-sunk' : ''}`}
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
                    <td className="px-2 py-1 text-xs text-ink-mute">{n.source ?? '—'}</td>
                  </tr>
                  {isExpanded ? (
                    <tr className="border-b bg-sunk">
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
      <div className="flex items-center gap-2 text-xs text-ink-mute">
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
              ? 'bg-accent-soft text-accent-ink border border-accent/30'
              : detail.coverage === 'PARTIAL'
                ? 'bg-warn-soft text-warn-ink border border-warn/30'
                : 'bg-sunk text-ink-soft border border-line-strong'
          }`}
        >
          {detail.coverage}
        </span>
      </div>
      {detail.rows.length === 0 ? (
        <p className="text-xs text-ink-mute">Aucune donnée pour cette note.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-ink-mute">
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
                  <tr key={sr.code} className="border-b text-ink-soft">
                    <td className="px-2 py-1 pl-6 font-mono">{sr.code}</td>
                    <td className="px-2 py-1 pl-6">{sr.label}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmt(sr.amount)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr className="border-t-2 bg-sunk font-semibold">
              <td className="px-2 py-1" colSpan={2}>
                Total
              </td>
              <td className="px-2 py-1 text-right font-mono">{fmt(detail.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {detail.methodology !== undefined ? (
        <p className="text-xs italic text-ink-mute">{detail.methodology}</p>
      ) : null}
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
              className="mt-1 block w-full rounded-sm border border-line-strong bg-paper px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40"
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
            <Loader2 className="h-5 w-5 animate-spin text-ink-mute" aria-label="chargement" />
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (activeSessionId === '') return;
              void api.download(
                `/organizations/${orgId}/reports/import-diagnostic/${activeSessionId}.pdf`,
                `import-diagnostic-${activeSessionId}.pdf`,
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
          <div className="rounded border border-line bg-sunk p-4 text-sm text-ink-soft">
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

  // Mapping verdict → palette sémantique. « conforme » = accent (vert),
  // « à corriger » = warn (ambré), autre (rejeté) = critical (rouge).
  // Le verdict est l'élément le plus visible, ses tokens reflètent
  // l'urgence d'action.
  const palette =
    verdict.status === 'conforme'
      ? {
          headerBg: 'bg-accent-soft',
          headerText: 'text-accent-ink',
          icon: CheckCircle2,
          iconColor: 'text-accent',
        }
      : verdict.status === 'à corriger'
        ? {
            headerBg: 'bg-warn-soft',
            headerText: 'text-warn-ink',
            icon: AlertTriangle,
            iconColor: 'text-warn',
          }
        : {
            headerBg: 'bg-critical-soft',
            headerText: 'text-critical-ink',
            icon: XCircle,
            iconColor: 'text-critical',
          };
  const Icon = palette.icon;

  return (
    <section className="overflow-hidden rounded-md border border-line">
      {/* Bandeau verdict : statut + résumé textuel d'action. C'est le
          premier signal — vert/ambre/rouge selon canCommit. */}
      <header className={cn('flex items-start gap-3 px-5 py-4', palette.headerBg)}>
        <Icon className={cn('h-6 w-6 shrink-0', palette.iconColor)} strokeWidth={1.5} />
        <div className={cn('flex-1 min-w-0', palette.headerText)}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <p className="font-display text-xl font-medium tracking-tight capitalize">
              {verdict.status}
            </p>
            <p className="text-xs">
              <span className="font-mono tabular-nums">{verdict.criticalCount}</span> critique
              {verdict.criticalCount > 1 ? 's' : ''} ·{' '}
              <span className="font-mono tabular-nums">{verdict.warningCount}</span>{' '}
              avertissement{verdict.warningCount > 1 ? 's' : ''} ·{' '}
              <span className="font-mono tabular-nums">{verdict.infoCount}</span> info
            </p>
          </div>
          <p className="mt-1.5 text-sm leading-snug">
            {verdict.canCommit
              ? 'Cette session peut être committée. Les avertissements méritent un coup d’œil mais ne bloquent pas.'
              : 'Cette session ne peut PAS être committée en l’état. Corriger les anomalies critiques ci-dessous avant de réessayer.'}
          </p>
        </div>
      </header>

      {/* Bande de totaux : Débit / Crédit / Écart (équilibre). Sépare
          par lignes pixel pour éviter d'imbriquer trop de cards. */}
      <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">∑ Débit</p>
          <p className="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
            {fmt(totals.totalDebit)}{' '}
            <span className="text-xs font-normal text-ink-mute">FCFA</span>
          </p>
        </div>
        <div className="bg-paper px-4 py-2.5">
          <p className="text-2xs uppercase tracking-wider text-ink-mute">∑ Crédit</p>
          <p className="mt-0.5 font-mono text-lg font-medium tabular-nums text-ink">
            {fmt(totals.totalCredit)}{' '}
            <span className="text-xs font-normal text-ink-mute">FCFA</span>
          </p>
        </div>
        <div
          className={cn(
            'px-4 py-2.5',
            totals.isBalanced ? 'bg-accent-soft/60' : 'bg-critical-soft',
          )}
        >
          <p
            className={cn(
              'text-2xs uppercase tracking-wider',
              totals.isBalanced ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            {totals.isBalanced ? 'Équilibré' : 'Écart D-C'}
          </p>
          <p
            className={cn(
              'mt-0.5 font-mono text-lg font-medium tabular-nums',
              totals.isBalanced ? 'text-accent-ink' : 'text-critical-ink',
            )}
          >
            {totals.isBalanced ? (
              <>
                <CheckCircle2 className="mr-1 inline h-4 w-4" />
                0,00
              </>
            ) : (
              <>
                {fmt(totals.balanceDelta)}{' '}
                <span className="text-xs font-normal">FCFA</span>
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}

function ImportTrialBalanceTable({ report }: { readonly report: ImportDiagnosticReport }) {
  if (report.trialBalance.length === 0) {
    return (
      <div className="rounded border border-line bg-sunk p-4 text-sm text-ink-soft">
        Aucune ligne de balance — la session ne contient pas d&apos;écritures parsables.
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 font-semibold">Balance des comptes (prévisionnelle)</h3>
      <div className="overflow-x-auto rounded border border-line">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-sunk">
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
          <tbody className="divide-y divide-line bg-paper">
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
                    <Badge variant="outline" className="border-accent/40 text-accent-ink">
                      existant
                    </Badge>
                  ) : row.autoProvisionable ? (
                    <Badge variant="outline" className="border-warn/40 text-warn-ink">
                      auto-créé au commit
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-critical/40 text-critical-ink">
                      inconnu
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-sunk font-semibold">
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
      <div className="rounded border border-accent/30 bg-accent-soft p-4 text-sm text-accent-ink">
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
      ? { border: 'border-critical/30', bg: 'bg-critical-soft', icon: XCircle, iconColor: 'text-critical' }
      : severity === 'warning'
      ? { border: 'border-warn/30', bg: 'bg-warn-soft', icon: AlertTriangle, iconColor: 'text-warn' }
      : { border: 'border-line', bg: 'bg-sunk', icon: Info, iconColor: 'text-ink-soft' };
  const Icon = palette.icon;
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium text-ink">{title}</h4>
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
            <div className="mt-2 text-sm text-ink">
              <p>{g.description}</p>
              {g.samples.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-medium uppercase text-ink-mute">
                    Exemples ({g.samples.length} sur {g.count})
                  </span>
                  <ul className="mt-1 space-y-1 text-xs text-ink">
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
    <div className="rounded-lg border border-line bg-sunk p-4">
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
                  ? 'border-critical/40 text-critical-ink'
                  : item.priority === 2
                  ? 'border-warn/40 text-warn-ink'
                  : 'border-line-strong text-ink'
              }
            >
              P{item.priority}
            </Badge>
            <div className="flex-1">
              <div className="font-medium">
                {item.title}{' '}
                <span className="text-xs font-normal text-ink-mute">
                  · {item.affectedCount} ligne{item.affectedCount > 1 ? 's' : ''}
                </span>
                {item.autoFixable && (
                  <Badge variant="outline" className="ml-2 border-accent/40 text-accent-ink">
                    auto-fix
                  </Badge>
                )}
              </div>
              <p className="text-ink-soft">{item.description}</p>
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
